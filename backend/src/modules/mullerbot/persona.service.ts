import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { UpsertPersonaDto, ExemploDto, TomVoz } from './persona.dto';

const TOM_INSTRUCAO: Record<TomVoz, string> = {
  FORMAL: 'Tom formal e respeitoso. Use "senhor"/"senhora", evite gírias e seja direto.',
  PROFISSIONAL: 'Tom profissional e equilibrado. Linguagem clara, sem gírias, mas natural.',
  AMIGAVEL:
    'Tom amigável e caloroso. Trate o cliente como parceiro de longa data, sem perder profissionalismo.',
  DESCONTRAIDO: 'Tom descontraído e leve. Pode usar expressões coloquiais e emojis com moderação.',
  ENTUSIASMADO:
    'Tom entusiasmado e energético. Destaque benefícios, use vocabulário positivo (ótimo, excelente).',
};

const SYSTEM_PROMPT_BASE = `Você é o {{nome}}, assistente comercial da Betinna.ai.

Responsabilidade: ajudar o representante comercial respondendo perguntas sobre o catálogo de produtos da empresa dele.

Regras OBRIGATÓRIAS:
1. Use APENAS o catálogo fornecido na mensagem do usuário. NÃO invente produtos, preços, especificações nem disponibilidade.
2. Se a pergunta não puder ser respondida com o catálogo fornecido, diga claramente: "Não encontrei essa informação no catálogo. Confirme com a equipe comercial."
3. Quando citar um produto, mencione nome + SKU (se disponível) entre parênteses. Ex: "Óleo de Girassol 5L (SKU OLE-GIR-5L)".
4. Mantenha respostas concisas e diretas — 2-4 parágrafos curtos no máximo.
5. NÃO repita o prompt nem mencione "catálogo fornecido" ou "{{nome}}"; apenas responda naturalmente.
6. Responda em português brasileiro.`;

export interface PersonaResult {
  id: string;
  empresaId: string;
  nome: string;
  tomVoz: TomVoz;
  instrucoes?: string | null;
  exemplos?: ExemploDto[];
  saudacao?: string | null;
  ativo: boolean;
  systemPromptPreview: string;
  atualizadoEm: Date;
}

/**
 * Gerencia a persona do MullerBot por empresa.
 * Singleton via UNIQUE(empresaId).
 *
 * `compilarSystemPrompt` é chamado pelo MullerBotService antes de cada
 * pergunta — substitui o SYSTEM_PROMPT hardcoded.
 */
@Injectable()
export class MullerBotPersonaService {
  private readonly logger = new Logger(MullerBotPersonaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthenticatedUser): Promise<PersonaResult> {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.mullerBotPersona.findUnique({ where: { empresaId } });
    if (!row) {
      return this.defaultPersona(empresaId);
    }
    return this.toResult(row);
  }

  async upsert(user: AuthenticatedUser, dto: UpsertPersonaDto): Promise<PersonaResult> {
    const empresaId = this.requireEmpresa(user);
    const data = {
      nome: dto.nome,
      tomVoz: dto.tomVoz,
      instrucoes: dto.instrucoes ?? null,
      // Prisma exige JsonNull explícito quando o campo é Json nullable
      exemplosJson:
        dto.exemplos && dto.exemplos.length > 0
          ? (dto.exemplos as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      saudacao: dto.saudacao ?? null,
      ativo: dto.ativo,
    };
    const row = await this.prisma.mullerBotPersona.upsert({
      where: { empresaId },
      create: { empresaId, ...data },
      update: data,
    });
    this.logger.log(`Persona atualizada para empresa ${empresaId}`);
    return this.toResult(row);
  }

  async reset(user: AuthenticatedUser): Promise<PersonaResult> {
    const empresaId = this.requireEmpresa(user);
    await this.prisma.mullerBotPersona.deleteMany({ where: { empresaId } });
    return this.defaultPersona(empresaId);
  }

  /**
   * Compila o system prompt usando a persona ativa.
   * Usado pelo MullerBotService.
   */
  async compilarSystemPrompt(empresaId: string): Promise<string> {
    const row = await this.prisma.mullerBotPersona.findUnique({ where: { empresaId } });
    const nome = row?.ativo ? row.nome : 'MullerBot';
    const tomVoz = (row?.ativo ? row.tomVoz : 'PROFISSIONAL') as TomVoz;

    let prompt = SYSTEM_PROMPT_BASE.replace(/\{\{nome\}\}/g, nome);
    prompt += `\n\nTom de voz: ${TOM_INSTRUCAO[tomVoz] ?? TOM_INSTRUCAO.PROFISSIONAL}`;
    if (row?.ativo && row.instrucoes) {
      prompt += `\n\nInstruções específicas desta empresa:\n${row.instrucoes}`;
    }
    if (row?.ativo && row.exemplosJson) {
      const exemplos = row.exemplosJson as unknown as ExemploDto[];
      if (Array.isArray(exemplos) && exemplos.length > 0) {
        prompt += '\n\nExemplos de como responder (siga o estilo):';
        for (const ex of exemplos.slice(0, 5)) {
          prompt += `\n— Pergunta: "${ex.pergunta}"\n  Resposta: "${ex.resposta}"`;
        }
      }
    }
    return prompt;
  }

  /**
   * Fase 2 — System prompt pro bot de WhatsApp (PURO CONVERSA, sem catálogo).
   * Reusa o que o usuário edita na persona (nome, tom, instruções), mas com um
   * envelope conversacional de atendimento — sem a regra "use só o catálogo".
   * Quando o catálogo for conectado (próxima fase), trocamos por uma versão
   * que injeta produtos.
   */
  async compilarSystemPromptConversa(empresaId: string): Promise<string> {
    const row = await this.prisma.mullerBotPersona.findUnique({ where: { empresaId } });
    const nome = row?.ativo ? row.nome : 'Muller';
    const tomVoz = (row?.ativo ? row.tomVoz : 'AMIGAVEL') as TomVoz;

    let prompt = `Você é o ${nome}, assistente virtual de atendimento da empresa, conversando com clientes pelo WhatsApp.
Responda de forma natural, cordial e útil, em português brasileiro, com mensagens curtas (estilo WhatsApp).
Nunca invente preços, prazos, descontos ou condições — se não tiver certeza, seja honesto e diga que vai confirmar com a equipe.
Se o cliente pedir algo que você não pode resolver, avise com gentileza que um atendente humano vai dar sequência.`;
    prompt += `\n\nTom de voz: ${TOM_INSTRUCAO[tomVoz] ?? TOM_INSTRUCAO.AMIGAVEL}`;
    if (row?.ativo && row.instrucoes) {
      prompt += `\n\nInstruções da empresa:\n${row.instrucoes}`;
    }
    return prompt;
  }

  // ─── Internals ────────────────────────────────────────────────

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private toResult(row: {
    id: string;
    empresaId: string;
    nome: string;
    tomVoz: string;
    instrucoes: string | null;
    exemplosJson: unknown;
    saudacao: string | null;
    ativo: boolean;
    atualizadoEm: Date;
  }): PersonaResult {
    const tomVoz = (row.tomVoz as TomVoz) ?? 'PROFISSIONAL';
    const exemplos = Array.isArray(row.exemplosJson) ? (row.exemplosJson as ExemploDto[]) : [];
    return {
      id: row.id,
      empresaId: row.empresaId,
      nome: row.nome,
      tomVoz,
      instrucoes: row.instrucoes,
      exemplos,
      saudacao: row.saudacao,
      ativo: row.ativo,
      systemPromptPreview: '',
      atualizadoEm: row.atualizadoEm,
    };
  }

  private async defaultPersona(empresaId: string): Promise<PersonaResult> {
    return {
      id: '',
      empresaId,
      nome: 'MullerBot',
      tomVoz: 'PROFISSIONAL',
      instrucoes: null,
      exemplos: [],
      saudacao: null,
      ativo: false,
      systemPromptPreview: '',
      atualizadoEm: new Date(),
    };
  }
}
