import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { GoogleOAuthService } from './google-oauth.service';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const PASTA_MIME = 'application/vnd.google-apps.folder';

export interface ArquivoNoDrive {
  id: string;
  url: string;
}

/**
 * Cópia do contrato assinado no Google Drive.
 *
 * **Por que existe:** o PDF já mora no Storage do app, e o contrato no ERP
 * carrega o link até ele — mas o Tiny **não anexa arquivo em contrato** (medido
 * contra a API em 12/09: rota de anexo não existe e `contrato.alterar.php`
 * aceita `anexos` com status OK e ignora em silêncio). O Drive é o lugar onde o
 * arquivo fica ao alcance de quem não abre o app: contador, jurídico, o próprio
 * diretor no celular.
 *
 * **Escopo `drive.file`, e isso é uma escolha.** Ele dá acesso SÓ ao que este
 * app criou — a Betinna não enxerga, não lista e não apaga o resto do Drive de
 * ninguém. `drive` completo resolveria o mesmo problema pedindo a chave da casa
 * inteira.
 *
 * ⚠️ **A credencial é de um USUÁRIO, não da empresa** (`UsuarioIntegracao`,
 * D12): o arquivo nasce no Drive de quem conectou, e a cota é a dele. Quem
 * conecta decide em qual conta os contratos ficam guardados — por isso o dono
 * é procurado entre DIRECTOR/ADMIN, e não "o primeiro que aparecer".
 */
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Quem empresta a conta do Drive pra esta empresa.
   *
   * Ordem: DIRECTOR antes de ADMIN — o contrato é documento do tenant, e o
   * mandatário dele é o diretor (D48). `null` quando ninguém conectou o Google,
   * que é o estado normal até alguém clicar em conectar: não é erro.
   */
  async donoDoDrive(empresaId: string): Promise<string | null> {
    const conexoes = await this.prisma.usuarioIntegracao.findMany({
      where: {
        servico: 'google_calendar',
        ativo: true,
        usuario: {
          status: 'ATIVO',
          role: { in: ['DIRECTOR', 'ADMIN'] },
          empresas: { some: { empresaId } },
        },
      },
      select: { usuarioId: true, usuario: { select: { role: true } } },
    });
    if (conexoes.length === 0) return null;
    const diretor = conexoes.find((c) => c.usuario.role === 'DIRECTOR');
    return (diretor ?? conexoes[0]).usuarioId;
  }

  /**
   * Sobe o PDF e devolve id + link. Cria a pasta na primeira vez.
   *
   * Não lança: a cópia no Drive é conveniência, e derrubar o webhook de
   * assinatura por causa dela trocaria um arquivo a menos por um contrato que
   * não fica assinado.
   */
  async guardarContrato(
    empresaId: string,
    nomeArquivo: string,
    pdf: Buffer,
    pasta = 'Contratos assinados — Betinna',
  ): Promise<ArquivoNoDrive | null> {
    const userId = await this.donoDoDrive(empresaId);
    if (!userId) {
      this.logger.log(
        `Drive: ninguém da empresa ${empresaId} conectou o Google — contrato não copiado (o PDF está no app).`,
      );
      return null;
    }
    try {
      const token = await this.oauth.getAccessToken(userId);
      const pastaId = await this.acharOuCriarPasta(token, pasta);
      return await this.upload(token, pastaId, nomeArquivo, pdf);
    } catch (err) {
      this.logger.error(
        `Drive: contrato não copiado (${err instanceof Error ? err.message : String(err)})`,
      );
      return null;
    }
  }

  /**
   * ⚠️ A busca é limitada ao que ESTE app criou (consequência do `drive.file`):
   * uma pasta de mesmo nome criada à mão pelo usuário não aparece aqui, e o app
   * cria a sua. É o preço de não pedir acesso ao Drive inteiro.
   */
  private async acharOuCriarPasta(token: string, nome: string): Promise<string> {
    const q = encodeURIComponent(
      `name = '${nome.replace(/'/g, "\\'")}' and mimeType = '${PASTA_MIME}' and trashed = false`,
    );
    const busca = await this.chamar<{ files?: Array<{ id: string }> }>(
      'GET',
      `${DRIVE_FILES}?q=${q}&fields=files(id)&pageSize=1`,
      token,
    );
    const achada = busca.files?.[0]?.id;
    if (achada) return achada;

    const criada = await this.chamar<{ id: string }>('POST', `${DRIVE_FILES}?fields=id`, token, {
      body: JSON.stringify({ name: nome, mimeType: PASTA_MIME }),
      contentType: 'application/json',
    });
    this.logger.log(`Drive: pasta "${nome}" criada (${criada.id})`);
    return criada.id;
  }

  /** Upload multipart: metadados + bytes numa requisição só. */
  private async upload(
    token: string,
    pastaId: string,
    nome: string,
    pdf: Buffer,
  ): Promise<ArquivoNoDrive> {
    const limite = `betinna-${Date.now().toString(36)}`;
    const meta = JSON.stringify({ name: nome, parents: [pastaId] });
    const corpo = Buffer.concat([
      Buffer.from(
        `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
          `--${limite}\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      pdf,
      Buffer.from(`\r\n--${limite}--\r\n`),
    ]);
    const r = await this.chamar<{ id: string; webViewLink?: string }>(
      'POST',
      `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`,
      token,
      { body: corpo, contentType: `multipart/related; boundary=${limite}` },
    );
    const url = r.webViewLink ?? `https://drive.google.com/file/d/${r.id}/view`;
    this.logger.log(`Drive: "${nome}" guardado (${r.id})`);
    return { id: r.id, url };
  }

  private async chamar<T>(
    metodo: 'GET' | 'POST',
    url: string,
    token: string,
    corpo?: { body: string | Buffer; contentType: string },
  ): Promise<T> {
    const r = await fetch(url, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(corpo ? { 'Content-Type': corpo.contentType } : {}),
      },
      ...(corpo ? { body: corpo.body as BodyInit } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const texto = await r.text();
    if (!r.ok) {
      // A mensagem do Google diz o que falta (escopo, cota, permissão) — e é
      // ela que evita a próxima sessão adivinhar por que o arquivo não subiu.
      throw new Error(`Drive ${r.status}: ${texto.slice(0, 200)}`);
    }
    return JSON.parse(texto) as T;
  }
}
