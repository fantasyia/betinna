import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EstoqueService } from './estoque.service';
import {
  MAX_IMAGENS_COSTURA,
  type Costura,
  aplicarImagens,
  costuraGravada,
  costuraVazia,
  medidasForaDaGrade,
} from './ficha-costura';
import type { CosturaDto } from './fichas.dto';
import { InsumoFotosService, type ArquivoFoto } from './insumo-fotos.service';

/** Desenho técnico precisa de resolução: até 2 MB em WebP. */
const MAX_IMAGEM_BYTES = 2 * 1024 * 1024;

/**
 * Ficha de costura da grade (#03 Modelista, 01/11): ler, gravar e as imagens.
 * Mora na ficha técnica (cria a ficha vazia se a grade ainda não tem).
 */
@Injectable()
export class FichaCosturaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: EstoqueService,
    private readonly fotos: InsumoFotosService,
  ) {}

  private async grade(empresaId: string, modeloLinhaId: string) {
    const ml = await this.prisma.catalogoModeloLinha.findFirst({
      where: { id: modeloLinhaId, modelo: { empresaId } },
      select: {
        id: true,
        modelo: { select: { nome: true } },
        linha: { select: { nome: true } },
        tamanhos: { select: { tamanho: { select: { nome: true, ordem: true } } } },
        fichaTecnica: { select: { costura: true } },
      },
    });
    if (!ml) throw new NotFoundException('Linha do modelo', modeloLinhaId);
    return ml;
  }

  /** Com a URL pública de cada imagem (o path fica guardado). */
  comUrls(c: Costura | null) {
    if (!c) return null;
    return { ...c, imagens: c.imagens.map((i) => ({ ...i, url: this.fotos.urlPublica(i.path) })) };
  }

  private async gravar(empresaId: string, modeloLinhaId: string, c: Costura) {
    const costura = { ...c, atualizadoEm: new Date().toISOString() };
    const json = costura as unknown as Prisma.InputJsonValue;
    await this.prisma.fichaTecnica.upsert({
      where: { modeloLinhaId },
      create: { empresaId, modeloLinhaId, costura: json },
      update: { costura: json },
    });
    return costura;
  }

  async ver(user: AuthenticatedUser, modeloLinhaId: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const ml = await this.grade(empresaId, modeloLinhaId);
    return {
      modeloLinhaId,
      modelo: ml.modelo.nome,
      linha: ml.linha.nome,
      tamanhos: ml.tamanhos
        .sort((a, b) => a.tamanho.ordem - b.tamanho.ordem)
        .map((t) => t.tamanho.nome),
      costura: this.comUrls(costuraGravada(ml.fichaTecnica?.costura)),
    };
  }

  async salvar(user: AuthenticatedUser, modeloLinhaId: string, dto: CosturaDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const ml = await this.grade(empresaId, modeloLinhaId);
    const fora = medidasForaDaGrade(
      dto.medidas,
      ml.tamanhos.map((t) => t.tamanho.nome),
    );
    if (fora.length) {
      throw new BusinessRuleException(
        `Medidas: tamanho fora da grade ${ml.linha.nome}: ${fora.join(', ')}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    const atual = costuraGravada(ml.fichaTecnica?.costura) ?? costuraVazia();
    let r: ReturnType<typeof aplicarImagens>;
    try {
      r = aplicarImagens(atual.imagens, dto.imagens);
    } catch (err) {
      throw new BusinessRuleException((err as Error).message, ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    const salvo = await this.gravar(empresaId, modeloLinhaId, {
      ...dto,
      imagens: r.imagens,
      sequencia: [...dto.sequencia].sort((a, b) => a.ordem - b.ordem),
      atualizadoEm: '',
    });
    await this.fotos.remover(r.removidas);
    return this.comUrls(salvo);
  }

  async subirImagem(
    user: AuthenticatedUser,
    modeloLinhaId: string,
    arquivo: ArquivoFoto,
    legenda: string | null,
  ) {
    const empresaId = await this.erp.empresaLigada(user);
    const ml = await this.grade(empresaId, modeloLinhaId);
    const atual = costuraGravada(ml.fichaTecnica?.costura) ?? costuraVazia();
    if (atual.imagens.length >= MAX_IMAGENS_COSTURA) {
      throw new BusinessRuleException(
        `A ficha de costura já tem ${MAX_IMAGENS_COSTURA} imagens — apague uma antes`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    this.fotos.validar(arquivo, MAX_IMAGEM_BYTES, 'Imagem');
    const id = randomBytes(6).toString('hex');
    const path = `costura/${empresaId}/${modeloLinhaId}/${Date.now()}_${id}.webp`;
    await this.fotos.subir(path, arquivo.buffer);
    try {
      const salvo = await this.gravar(empresaId, modeloLinhaId, {
        ...atual,
        imagens: [...atual.imagens, { id, path, legenda: legenda?.trim().slice(0, 120) || null }],
      });
      return this.comUrls(salvo);
    } catch (err) {
      await this.fotos.remover([path]);
      throw err;
    }
  }

  async excluirImagem(user: AuthenticatedUser, modeloLinhaId: string, imagemId: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const ml = await this.grade(empresaId, modeloLinhaId);
    const atual = costuraGravada(ml.fichaTecnica?.costura);
    const img = atual?.imagens.find((i) => i.id === imagemId);
    if (!atual || !img) throw new NotFoundException('Imagem da ficha de costura', imagemId);
    const salvo = await this.gravar(empresaId, modeloLinhaId, {
      ...atual,
      imagens: atual.imagens.filter((i) => i.id !== imagemId),
    });
    await this.fotos.remover([img.path]);
    return this.comUrls(salvo);
  }
}
