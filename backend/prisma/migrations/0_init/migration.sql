-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ATIVO', 'PENDENTE', 'INATIVO');

-- CreateEnum
CREATE TYPE "ClienteStatus" AS ENUM ('ATIVO', 'NOVO', 'PROSPECT', 'RISCO', 'CRITICO', 'INATIVO');

-- CreateEnum
CREATE TYPE "ClienteOmieStatus" AS ENUM ('ATIVO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "PedidoStatus" AS ENUM ('RASCUNHO', 'AGUARDANDO_APROVACAO', 'ENVIADO_OMIE', 'PAGO', 'EM_SEPARACAO', 'ENVIADO', 'ENTREGUE', 'CANCELADO');

-- CreateEnum
CREATE TYPE "PedidoOrigem" AS ENUM ('REP_APP', 'WHATSAPP', 'OMIE', 'MARKETPLACE_ML', 'MARKETPLACE_SHOPEE', 'MARKETPLACE_AMAZON', 'MARKETPLACE_TIKTOK', 'EMAIL', 'FORMULARIO');

-- CreateEnum
CREATE TYPE "PagamentoForma" AS ENUM ('BOLETO', 'PIX');

-- CreateEnum
CREATE TYPE "PropostaStatus" AS ENUM ('RASCUNHO', 'ENVIADA', 'NEGOCIACAO', 'AGUARDANDO_ASSINATURA', 'ACEITA', 'RECUSADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "LeadEtapa" AS ENUM ('NOVO', 'QUALIFICANDO', 'PROPOSTA', 'NEGOCIACAO', 'GANHO', 'PERDIDO');

-- CreateEnum
CREATE TYPE "CanalOrigem" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'FORMULARIO', 'SITE', 'EMAIL', 'TELEFONE', 'INDICACAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "AprovacaoStatus" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA');

-- CreateEnum
CREATE TYPE "AmostraStatus" AS ENUM ('ENVIADA', 'AGUARDANDO_FOLLOWUP', 'CONVERTIDA', 'NAO_CONVERTEU', 'VENCIDA');

-- CreateEnum
CREATE TYPE "OcorrenciaTipo" AS ENUM ('ENTREGA', 'QUALIDADE', 'PRAZO', 'PRODUTO', 'FINANCEIRO', 'OUTRO');

-- CreateEnum
CREATE TYPE "OcorrenciaStatus" AS ENUM ('ABERTA', 'EM_ANDAMENTO', 'RESOLVIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "AgendaTipo" AS ENUM ('VISITA', 'LIGACAO', 'REUNIAO', 'ENTREGA', 'TAREFA');

-- CreateEnum
CREATE TYPE "MarketplacePlatform" AS ENUM ('ML', 'SHOPEE', 'AMAZON', 'TIKTOK');

-- CreateEnum
CREATE TYPE "MarketplaceMsgStatus" AS ENUM ('URGENTE', 'PENDENTE', 'RESPONDIDA');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL', 'MARKETPLACE_ML', 'MARKETPLACE_SHOPEE', 'MARKETPLACE_AMAZON', 'MARKETPLACE_TIKTOK');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'STICKER', 'LOCATION', 'CONTACT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ABERTA', 'PENDENTE', 'RESOLVIDA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "ConversationCategoria" AS ENUM ('GERAL', 'PRE_VENDA', 'POS_VENDA', 'RECLAMACAO', 'MEDIACAO', 'DEVOLUCAO', 'DISPUTA');

-- CreateEnum
CREATE TYPE "MarketplaceIncidentTipo" AS ENUM ('RECLAMACAO', 'DEVOLUCAO', 'MEDIACAO', 'DISPUTA', 'CANCELAMENTO');

-- CreateEnum
CREATE TYPE "MarketplaceIncidentStatus" AS ENUM ('ABERTO', 'AGUARDANDO_VENDEDOR', 'AGUARDANDO_COMPRADOR', 'EM_MEDIACAO', 'RESOLVIDO', 'EXPIRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ComissaoTipo" AS ENUM ('REP', 'GERENTE');

-- CreateEnum
CREATE TYPE "FluxoStatus" AS ENUM ('RASCUNHO', 'ATIVO', 'PAUSADO', 'ARQUIVADO');

-- CreateEnum
CREATE TYPE "FluxoNoTipo" AS ENUM ('TRIGGER', 'CONDICAO', 'ACAO', 'DELAY');

-- CreateEnum
CREATE TYPE "FluxoTriggerTipo" AS ENUM ('LEAD_CRIADO', 'LEAD_ETAPA_MUDOU', 'PEDIDO_APROVADO', 'PEDIDO_ENTREGUE', 'OCORRENCIA_ABERTA', 'CLIENTE_INATIVO_30D', 'AMOSTRA_FOLLOWUP', 'CRON_AGENDADO');

-- CreateEnum
CREATE TYPE "FluxoAcaoTipo" AS ENUM ('ENVIAR_WHATSAPP', 'ENVIAR_EMAIL', 'CRIAR_TAREFA', 'MUDAR_TAG', 'MOVER_LEAD_ETAPA', 'ATRIBUIR_REP', 'WEBHOOK_EXTERNO');

-- CreateEnum
CREATE TYPE "FluxoExecucaoStatus" AS ENUM ('PENDENTE', 'EM_EXECUCAO', 'CONCLUIDO', 'FALHOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "CampanhaStatus" AS ENUM ('RASCUNHO', 'AGENDADA', 'ENVIANDO', 'ENVIADA', 'PAUSADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "CampanhaCanal" AS ENUM ('WHATSAPP', 'EMAIL', 'WHATSAPP_EMAIL');

-- CreateEnum
CREATE TYPE "DestinatarioStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'LIDO', 'ERRO');

-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "ramo" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "subtitulo" TEXT,
    "plano" TEXT NOT NULL DEFAULT 'Pro',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "avatar" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDENTE',
    "ultimoAcesso" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "regiao" TEXT,
    "tetoDesconto" DOUBLE PRECISION DEFAULT 5,
    "comissaoPadrao" DOUBLE PRECISION DEFAULT 5,
    "apiKeyOpenAI" TEXT,
    "googleCalendarToken" TEXT,
    "gerenteId" TEXT,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioEmpresa" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "UsuarioEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permissao" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "modulo" TEXT NOT NULL,
    "podeVer" BOOLEAN NOT NULL DEFAULT true,
    "podeEditar" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Permissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "codigoOmie" TEXT,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "segmento" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "regiao" TEXT,
    "status" "ClienteStatus" NOT NULL DEFAULT 'NOVO',
    "omieStatus" "ClienteOmieStatus" NOT NULL DEFAULT 'ATIVO',
    "score" INTEGER NOT NULL DEFAULT 50,
    "prazoPagamento" INTEGER NOT NULL DEFAULT 30,
    "limiteCredito" DOUBLE PRECISION,
    "ultimoPedidoEm" TIMESTAMP(3),
    "representanteId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '#7c3aed',

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteTag" (
    "clienteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ClienteTag_pkey" PRIMARY KEY ("clienteId","tagId")
);

-- CreateTable
CREATE TABLE "NotaPrivada" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotaPrivada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tamanho" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "codigoOmie" TEXT,
    "sku" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "marca" TEXT,
    "linha" TEXT,
    "categoria" TEXT,
    "unidade" TEXT,
    "precoTabela" DOUBLE PRECISION NOT NULL,
    "precoFabrica" DOUBLE PRECISION NOT NULL,
    "imagem" TEXT,
    "popularidade" INTEGER NOT NULL DEFAULT 0,
    "estoque" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientePrecoEspecial" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "precoEspecial" DOUBLE PRECISION NOT NULL,
    "descontoBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validoAte" TIMESTAMP(3),

    CONSTRAINT "ClientePrecoEspecial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepCatalogoItem" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "markup" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepCatalogoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "numeroOmie" TEXT,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "representanteId" TEXT,
    "aprovadorId" TEXT,
    "origem" "PedidoOrigem" NOT NULL DEFAULT 'REP_APP',
    "status" "PedidoStatus" NOT NULL DEFAULT 'RASCUNHO',
    "formaPagamento" "PagamentoForma" NOT NULL DEFAULT 'BOLETO',
    "condicaoPagamento" TEXT,
    "prazoEntrega" TIMESTAMP(3),
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "descontoGeral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comissao" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "motivoDesconto" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "enviadoOmieEm" TIMESTAMP(3),
    "pagoEm" TIMESTAMP(3),

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoItem" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoUnitario" DOUBLE PRECISION NOT NULL,
    "desconto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "negociado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PedidoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AprovacaoDesconto" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "representanteId" TEXT NOT NULL,
    "gerenteId" TEXT,
    "descontoSolicitado" DOUBLE PRECISION NOT NULL,
    "motivo" TEXT NOT NULL,
    "status" "AprovacaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "comentarioAprovador" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvidoEm" TIMESTAMP(3),

    CONSTRAINT "AprovacaoDesconto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposta" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "representanteId" TEXT,
    "status" "PropostaStatus" NOT NULL DEFAULT 'RASCUNHO',
    "probabilidade" INTEGER NOT NULL DEFAULT 50,
    "validoAte" TIMESTAMP(3),
    "formaPagamento" "PagamentoForma" NOT NULL DEFAULT 'BOLETO',
    "condicaoPagamento" TEXT,
    "prazoEntrega" TIMESTAMP(3),
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "descontoGeral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comissaoEstimada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "pdfUrl" TEXT,
    "pedidoId" TEXT,
    "convertidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropostaItem" (
    "id" TEXT NOT NULL,
    "propostaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "produtoNome" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoUnitario" DOUBLE PRECISION NOT NULL,
    "desconto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "negociado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PropostaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "representanteId" TEXT,
    "clienteId" TEXT,
    "nome" TEXT NOT NULL,
    "cidade" TEXT,
    "uf" TEXT,
    "segmento" TEXT,
    "contatoNome" TEXT,
    "contatoEmail" TEXT,
    "contatoTelefone" TEXT,
    "valorEstimado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "canalOrigem" "CanalOrigem" NOT NULL DEFAULT 'WHATSAPP',
    "etapa" "LeadEtapa" NOT NULL DEFAULT 'NOVO',
    "score" INTEGER NOT NULL DEFAULT 50,
    "proximaAcao" TEXT,
    "observacoes" TEXT,
    "motivoGanho" TEXT,
    "motivoPerda" TEXT,
    "pedidoId" TEXT,
    "etapaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ocorrencia" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "pedidoId" TEXT,
    "responsavelId" TEXT,
    "criadoPorId" TEXT,
    "tipo" "OcorrenciaTipo" NOT NULL,
    "severidade" TEXT NOT NULL DEFAULT 'media',
    "status" "OcorrenciaStatus" NOT NULL DEFAULT 'ABERTA',
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "slaHoras" INTEGER NOT NULL DEFAULT 24,
    "slaVenceEm" TIMESTAMP(3) NOT NULL,
    "resolvidoEm" TIMESTAMP(3),
    "resolucao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ocorrencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcorrenciaComentario" (
    "id" TEXT NOT NULL,
    "ocorrenciaId" TEXT NOT NULL,
    "autorId" TEXT,
    "autorNome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "isSistema" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcorrenciaComentario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amostra" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "produtoNome" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "notaFiscal" TEXT,
    "enviadoEm" TIMESTAMP(3) NOT NULL,
    "followUpEm" TIMESTAMP(3),
    "status" "AmostraStatus" NOT NULL DEFAULT 'ENVIADA',
    "representanteNome" TEXT,

    CONSTRAINT "Amostra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comissao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "representanteId" TEXT NOT NULL,
    "tipo" "ComissaoTipo" NOT NULL DEFAULT 'REP',
    "percentual" DOUBLE PRECISION,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mes" INTEGER NOT NULL,
    "ano" INTEGER NOT NULL,
    "totalVendas" DOUBLE PRECISION NOT NULL,
    "totalComissao" DOUBLE PRECISION NOT NULL,
    "qtdPedidos" INTEGER NOT NULL,
    "pago" BOOLEAN NOT NULL DEFAULT false,
    "pagoEm" TIMESTAMP(3),
    "reciboUrl" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaItem" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "clienteId" TEXT,
    "titulo" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "duracao" INTEGER NOT NULL DEFAULT 60,
    "tipo" "AgendaTipo" NOT NULL DEFAULT 'VISITA',
    "observacao" TEXT,
    "googleEventId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fluxo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "FluxoStatus" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "triggerTipo" "FluxoTriggerTipo",
    "triggerConfig" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fluxo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FluxoNo" (
    "id" TEXT NOT NULL,
    "fluxoId" TEXT NOT NULL,
    "tipo" "FluxoNoTipo" NOT NULL,
    "acaoTipo" "FluxoAcaoTipo",
    "titulo" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "posX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posY" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "FluxoNo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FluxoEdge" (
    "id" TEXT NOT NULL,
    "fluxoId" TEXT NOT NULL,
    "sourceNoId" TEXT NOT NULL,
    "targetNoId" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "FluxoEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FluxoExecucao" (
    "id" TEXT NOT NULL,
    "fluxoId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "status" "FluxoExecucaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "contexto" JSONB NOT NULL,
    "jobId" TEXT,
    "iniciouEm" TIMESTAMP(3),
    "terminouEm" TIMESTAMP(3),
    "erroMsg" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FluxoExecucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FluxoExecucaoLog" (
    "id" TEXT NOT NULL,
    "execucaoId" TEXT NOT NULL,
    "noId" TEXT,
    "noTitulo" TEXT,
    "status" "FluxoExecucaoStatus" NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "erroMsg" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminadoEm" TIMESTAMP(3),

    CONSTRAINT "FluxoExecucaoLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campanha" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "canal" "CampanhaCanal" NOT NULL DEFAULT 'WHATSAPP',
    "status" "CampanhaStatus" NOT NULL DEFAULT 'RASCUNHO',
    "segTagIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "segRepIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "segClienteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objetivo" TEXT,
    "usarIaPersonalizacao" BOOLEAN NOT NULL DEFAULT false,
    "assunto" TEXT,
    "mensagemWa" TEXT,
    "mensagemEmail" TEXT,
    "agendadoPara" TIMESTAMP(3),
    "iniciadoEm" TIMESTAMP(3),
    "finalizadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campanha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaDestinatario" (
    "id" TEXT NOT NULL,
    "campanhaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "status" "DestinatarioStatus" NOT NULL DEFAULT 'PENDENTE',
    "erro" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "lido" BOOLEAN NOT NULL DEFAULT false,
    "lidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampanhaDestinatario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "canal" "MessageChannel" NOT NULL,
    "peerId" TEXT NOT NULL,
    "peerNome" TEXT,
    "proprietarioId" TEXT,
    "clienteId" TEXT,
    "atribuidoId" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ABERTA',
    "categoria" "ConversationCategoria" NOT NULL DEFAULT 'GERAL',
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "ultimaMsgEm" TIMESTAMP(3),
    "ultimaMsgPreview" VARCHAR(140),
    "metadata" JSONB,
    "incidentId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "tipo" "MessageType" NOT NULL DEFAULT 'TEXT',
    "conteudo" TEXT NOT NULL,
    "externalId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "mediaUrl" TEXT,
    "mediaMime" TEXT,
    "autorUsuarioId" TEXT,
    "meta" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceIncident" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "canal" "MessageChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "tipo" "MarketplaceIncidentTipo" NOT NULL,
    "status" "MarketplaceIncidentStatus" NOT NULL DEFAULT 'ABERTO',
    "motivo" TEXT,
    "motivoCodigo" TEXT,
    "pedidoExternoId" TEXT,
    "clienteId" TEXT,
    "valor" DOUBLE PRECISION,
    "valorReembolso" DOUBLE PRECISION,
    "prazoResposta" TIMESTAMP(3),
    "resumo" VARCHAR(280),
    "metadata" JSONB,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "resolvidoEm" TIMESTAMP(3),

    CONSTRAINT "MarketplaceIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceMsg" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "plataforma" "MarketplacePlatform" NOT NULL,
    "externoId" TEXT,
    "comprador" TEXT NOT NULL,
    "produtoNome" TEXT NOT NULL,
    "produtoDesc" TEXT,
    "pergunta" TEXT NOT NULL,
    "resposta" TEXT,
    "status" "MarketplaceMsgStatus" NOT NULL DEFAULT 'PENDENTE',
    "respondidoBot" BOOLEAN NOT NULL DEFAULT false,
    "respondidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceMsg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceOrder" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "plataforma" "MarketplacePlatform" NOT NULL,
    "numeroExterno" TEXT NOT NULL,
    "comprador" TEXT NOT NULL,
    "produtoNome" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pago',
    "rastreio" TEXT,
    "slaEnvio" INTEGER NOT NULL DEFAULT 48,
    "pedidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),

    CONSTRAINT "MarketplaceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegracaoConexao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "servico" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "credenciais" JSONB NOT NULL,
    "externalAccountId" TEXT,
    "ultimoSync" TIMESTAMP(3),
    "errosRecentes" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegracaoConexao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioIntegracao" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "servico" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "credenciais" JSONB NOT NULL,
    "ultimoSync" TIMESTAMP(3),
    "errosRecentes" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsuarioIntegracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "empresaId" TEXT,
    "acao" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "recursoId" TEXT,
    "detalhes" JSONB,
    "ip" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmpresaSequence" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmpresaSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_cnpj_key" ON "Empresa"("cnpj");

-- CreateIndex
CREATE INDEX "Empresa_ativo_idx" ON "Empresa"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_role_idx" ON "Usuario"("role");

-- CreateIndex
CREATE INDEX "Usuario_status_idx" ON "Usuario"("status");

-- CreateIndex
CREATE INDEX "Usuario_gerenteId_idx" ON "Usuario"("gerenteId");

-- CreateIndex
CREATE INDEX "UsuarioEmpresa_empresaId_idx" ON "UsuarioEmpresa"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "UsuarioEmpresa_usuarioId_empresaId_key" ON "UsuarioEmpresa"("usuarioId", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Permissao_role_modulo_key" ON "Permissao"("role", "modulo");

-- CreateIndex
CREATE INDEX "Cliente_empresaId_idx" ON "Cliente"("empresaId");

-- CreateIndex
CREATE INDEX "Cliente_representanteId_idx" ON "Cliente"("representanteId");

-- CreateIndex
CREATE INDEX "Cliente_status_idx" ON "Cliente"("status");

-- CreateIndex
CREATE INDEX "Cliente_omieStatus_idx" ON "Cliente"("omieStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_empresaId_codigoOmie_key" ON "Cliente"("empresaId", "codigoOmie");

-- CreateIndex
CREATE INDEX "Tag_empresaId_idx" ON "Tag"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_empresaId_nome_key" ON "Tag"("empresaId", "nome");

-- CreateIndex
CREATE INDEX "NotaPrivada_clienteId_idx" ON "NotaPrivada"("clienteId");

-- CreateIndex
CREATE INDEX "Documento_clienteId_idx" ON "Documento"("clienteId");

-- CreateIndex
CREATE INDEX "Produto_empresaId_linha_idx" ON "Produto"("empresaId", "linha");

-- CreateIndex
CREATE INDEX "Produto_empresaId_ativo_idx" ON "Produto"("empresaId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_empresaId_sku_key" ON "Produto"("empresaId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_empresaId_codigoOmie_key" ON "Produto"("empresaId", "codigoOmie");

-- CreateIndex
CREATE INDEX "ClientePrecoEspecial_clienteId_idx" ON "ClientePrecoEspecial"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientePrecoEspecial_clienteId_produtoId_key" ON "ClientePrecoEspecial"("clienteId", "produtoId");

-- CreateIndex
CREATE INDEX "RepCatalogoItem_usuarioId_idx" ON "RepCatalogoItem"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "RepCatalogoItem_usuarioId_produtoId_key" ON "RepCatalogoItem"("usuarioId", "produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_numeroOmie_key" ON "Pedido"("numeroOmie");

-- CreateIndex
CREATE INDEX "Pedido_empresaId_idx" ON "Pedido"("empresaId");

-- CreateIndex
CREATE INDEX "Pedido_clienteId_idx" ON "Pedido"("clienteId");

-- CreateIndex
CREATE INDEX "Pedido_representanteId_idx" ON "Pedido"("representanteId");

-- CreateIndex
CREATE INDEX "Pedido_status_idx" ON "Pedido"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_empresaId_numero_key" ON "Pedido"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "PedidoItem_pedidoId_idx" ON "PedidoItem"("pedidoId");

-- CreateIndex
CREATE UNIQUE INDEX "AprovacaoDesconto_pedidoId_key" ON "AprovacaoDesconto"("pedidoId");

-- CreateIndex
CREATE INDEX "AprovacaoDesconto_status_idx" ON "AprovacaoDesconto"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Proposta_pedidoId_key" ON "Proposta"("pedidoId");

-- CreateIndex
CREATE INDEX "Proposta_empresaId_idx" ON "Proposta"("empresaId");

-- CreateIndex
CREATE INDEX "Proposta_clienteId_idx" ON "Proposta"("clienteId");

-- CreateIndex
CREATE INDEX "Proposta_representanteId_idx" ON "Proposta"("representanteId");

-- CreateIndex
CREATE INDEX "Proposta_status_idx" ON "Proposta"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Proposta_empresaId_numero_key" ON "Proposta"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "PropostaItem_propostaId_idx" ON "PropostaItem"("propostaId");

-- CreateIndex
CREATE INDEX "Lead_empresaId_etapa_idx" ON "Lead"("empresaId", "etapa");

-- CreateIndex
CREATE INDEX "Lead_empresaId_representanteId_idx" ON "Lead"("empresaId", "representanteId");

-- CreateIndex
CREATE INDEX "Lead_clienteId_idx" ON "Lead"("clienteId");

-- CreateIndex
CREATE INDEX "Ocorrencia_empresaId_status_idx" ON "Ocorrencia"("empresaId", "status");

-- CreateIndex
CREATE INDEX "Ocorrencia_empresaId_responsavelId_idx" ON "Ocorrencia"("empresaId", "responsavelId");

-- CreateIndex
CREATE INDEX "Ocorrencia_clienteId_idx" ON "Ocorrencia"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "Ocorrencia_empresaId_numero_key" ON "Ocorrencia"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "OcorrenciaComentario_ocorrenciaId_idx" ON "OcorrenciaComentario"("ocorrenciaId");

-- CreateIndex
CREATE INDEX "Amostra_empresaId_idx" ON "Amostra"("empresaId");

-- CreateIndex
CREATE INDEX "Amostra_status_idx" ON "Amostra"("status");

-- CreateIndex
CREATE INDEX "Comissao_empresaId_idx" ON "Comissao"("empresaId");

-- CreateIndex
CREATE INDEX "Comissao_tipo_idx" ON "Comissao"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "Comissao_empresaId_representanteId_ano_mes_key" ON "Comissao"("empresaId", "representanteId", "ano", "mes");

-- CreateIndex
CREATE INDEX "AgendaItem_empresaId_idx" ON "AgendaItem"("empresaId");

-- CreateIndex
CREATE INDEX "AgendaItem_usuarioId_idx" ON "AgendaItem"("usuarioId");

-- CreateIndex
CREATE INDEX "AgendaItem_empresaId_data_idx" ON "AgendaItem"("empresaId", "data");

-- CreateIndex
CREATE INDEX "AgendaItem_data_idx" ON "AgendaItem"("data");

-- CreateIndex
CREATE INDEX "Fluxo_empresaId_status_idx" ON "Fluxo"("empresaId", "status");

-- CreateIndex
CREATE INDEX "Fluxo_empresaId_triggerTipo_idx" ON "Fluxo"("empresaId", "triggerTipo");

-- CreateIndex
CREATE INDEX "FluxoNo_fluxoId_idx" ON "FluxoNo"("fluxoId");

-- CreateIndex
CREATE INDEX "FluxoEdge_fluxoId_idx" ON "FluxoEdge"("fluxoId");

-- CreateIndex
CREATE INDEX "FluxoEdge_sourceNoId_idx" ON "FluxoEdge"("sourceNoId");

-- CreateIndex
CREATE UNIQUE INDEX "FluxoEdge_fluxoId_sourceNoId_targetNoId_label_key" ON "FluxoEdge"("fluxoId", "sourceNoId", "targetNoId", "label");

-- CreateIndex
CREATE INDEX "FluxoExecucao_fluxoId_status_idx" ON "FluxoExecucao"("fluxoId", "status");

-- CreateIndex
CREATE INDEX "FluxoExecucao_empresaId_idx" ON "FluxoExecucao"("empresaId");

-- CreateIndex
CREATE INDEX "FluxoExecucao_criadoEm_idx" ON "FluxoExecucao"("criadoEm");

-- CreateIndex
CREATE INDEX "FluxoExecucaoLog_execucaoId_idx" ON "FluxoExecucaoLog"("execucaoId");

-- CreateIndex
CREATE INDEX "Campanha_empresaId_idx" ON "Campanha"("empresaId");

-- CreateIndex
CREATE INDEX "Campanha_status_idx" ON "Campanha"("status");

-- CreateIndex
CREATE INDEX "Campanha_agendadoPara_idx" ON "Campanha"("agendadoPara");

-- CreateIndex
CREATE INDEX "CampanhaDestinatario_campanhaId_idx" ON "CampanhaDestinatario"("campanhaId");

-- CreateIndex
CREATE INDEX "CampanhaDestinatario_clienteId_idx" ON "CampanhaDestinatario"("clienteId");

-- CreateIndex
CREATE INDEX "CampanhaDestinatario_campanhaId_status_idx" ON "CampanhaDestinatario"("campanhaId", "status");

-- CreateIndex
CREATE INDEX "Conversation_empresaId_canal_peerId_proprietarioId_idx" ON "Conversation"("empresaId", "canal", "peerId", "proprietarioId");

-- CreateIndex
CREATE INDEX "Conversation_empresaId_idx" ON "Conversation"("empresaId");

-- CreateIndex
CREATE INDEX "Conversation_clienteId_idx" ON "Conversation"("clienteId");

-- CreateIndex
CREATE INDEX "Conversation_atribuidoId_idx" ON "Conversation"("atribuidoId");

-- CreateIndex
CREATE INDEX "Conversation_proprietarioId_idx" ON "Conversation"("proprietarioId");

-- CreateIndex
CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");

-- CreateIndex
CREATE INDEX "Conversation_categoria_idx" ON "Conversation"("categoria");

-- CreateIndex
CREATE INDEX "Conversation_incidentId_idx" ON "Conversation"("incidentId");

-- CreateIndex
CREATE INDEX "Conversation_ultimaMsgEm_idx" ON "Conversation"("ultimaMsgEm");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_direction_idx" ON "Message"("direction");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Message_criadoEm_idx" ON "Message"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_externalId_key" ON "Message"("conversationId", "externalId");

-- CreateIndex
CREATE INDEX "MarketplaceIncident_empresaId_idx" ON "MarketplaceIncident"("empresaId");

-- CreateIndex
CREATE INDEX "MarketplaceIncident_canal_status_idx" ON "MarketplaceIncident"("canal", "status");

-- CreateIndex
CREATE INDEX "MarketplaceIncident_clienteId_idx" ON "MarketplaceIncident"("clienteId");

-- CreateIndex
CREATE INDEX "MarketplaceIncident_prazoResposta_idx" ON "MarketplaceIncident"("prazoResposta");

-- CreateIndex
CREATE INDEX "MarketplaceIncident_abertoEm_idx" ON "MarketplaceIncident"("abertoEm");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceIncident_canal_externalId_key" ON "MarketplaceIncident"("canal", "externalId");

-- CreateIndex
CREATE INDEX "MarketplaceMsg_empresaId_idx" ON "MarketplaceMsg"("empresaId");

-- CreateIndex
CREATE INDEX "MarketplaceMsg_plataforma_idx" ON "MarketplaceMsg"("plataforma");

-- CreateIndex
CREATE INDEX "MarketplaceMsg_status_idx" ON "MarketplaceMsg"("status");

-- CreateIndex
CREATE INDEX "MarketplaceOrder_empresaId_idx" ON "MarketplaceOrder"("empresaId");

-- CreateIndex
CREATE INDEX "MarketplaceOrder_status_idx" ON "MarketplaceOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOrder_plataforma_numeroExterno_key" ON "MarketplaceOrder"("plataforma", "numeroExterno");

-- CreateIndex
CREATE INDEX "IntegracaoConexao_empresaId_idx" ON "IntegracaoConexao"("empresaId");

-- CreateIndex
CREATE INDEX "IntegracaoConexao_servico_externalAccountId_idx" ON "IntegracaoConexao"("servico", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegracaoConexao_empresaId_servico_key" ON "IntegracaoConexao"("empresaId", "servico");

-- CreateIndex
CREATE INDEX "UsuarioIntegracao_usuarioId_idx" ON "UsuarioIntegracao"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "UsuarioIntegracao_usuarioId_servico_key" ON "UsuarioIntegracao"("usuarioId", "servico");

-- CreateIndex
CREATE INDEX "AuditLog_usuarioId_idx" ON "AuditLog"("usuarioId");

-- CreateIndex
CREATE INDEX "AuditLog_empresaId_idx" ON "AuditLog"("empresaId");

-- CreateIndex
CREATE INDEX "AuditLog_criadoEm_idx" ON "AuditLog"("criadoEm");

-- CreateIndex
CREATE INDEX "EmpresaSequence_empresaId_idx" ON "EmpresaSequence"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "EmpresaSequence_empresaId_tipo_key" ON "EmpresaSequence"("empresaId", "tipo");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_gerenteId_fkey" FOREIGN KEY ("gerenteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_representanteId_fkey" FOREIGN KEY ("representanteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteTag" ADD CONSTRAINT "ClienteTag_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteTag" ADD CONSTRAINT "ClienteTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaPrivada" ADD CONSTRAINT "NotaPrivada_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaPrivada" ADD CONSTRAINT "NotaPrivada_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientePrecoEspecial" ADD CONSTRAINT "ClientePrecoEspecial_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientePrecoEspecial" ADD CONSTRAINT "ClientePrecoEspecial_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepCatalogoItem" ADD CONSTRAINT "RepCatalogoItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_representanteId_fkey" FOREIGN KEY ("representanteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_aprovadorId_fkey" FOREIGN KEY ("aprovadorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoItem" ADD CONSTRAINT "PedidoItem_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoItem" ADD CONSTRAINT "PedidoItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AprovacaoDesconto" ADD CONSTRAINT "AprovacaoDesconto_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AprovacaoDesconto" ADD CONSTRAINT "AprovacaoDesconto_representanteId_fkey" FOREIGN KEY ("representanteId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AprovacaoDesconto" ADD CONSTRAINT "AprovacaoDesconto_gerenteId_fkey" FOREIGN KEY ("gerenteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposta" ADD CONSTRAINT "Proposta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposta" ADD CONSTRAINT "Proposta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaItem" ADD CONSTRAINT "PropostaItem_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "Proposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_representanteId_fkey" FOREIGN KEY ("representanteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocorrencia" ADD CONSTRAINT "Ocorrencia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocorrencia" ADD CONSTRAINT "Ocorrencia_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocorrencia" ADD CONSTRAINT "Ocorrencia_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocorrencia" ADD CONSTRAINT "Ocorrencia_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcorrenciaComentario" ADD CONSTRAINT "OcorrenciaComentario_ocorrenciaId_fkey" FOREIGN KEY ("ocorrenciaId") REFERENCES "Ocorrencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcorrenciaComentario" ADD CONSTRAINT "OcorrenciaComentario_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amostra" ADD CONSTRAINT "Amostra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amostra" ADD CONSTRAINT "Amostra_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comissao" ADD CONSTRAINT "Comissao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comissao" ADD CONSTRAINT "Comissao_representanteId_fkey" FOREIGN KEY ("representanteId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fluxo" ADD CONSTRAINT "Fluxo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluxoNo" ADD CONSTRAINT "FluxoNo_fluxoId_fkey" FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluxoEdge" ADD CONSTRAINT "FluxoEdge_fluxoId_fkey" FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluxoEdge" ADD CONSTRAINT "FluxoEdge_sourceNoId_fkey" FOREIGN KEY ("sourceNoId") REFERENCES "FluxoNo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluxoEdge" ADD CONSTRAINT "FluxoEdge_targetNoId_fkey" FOREIGN KEY ("targetNoId") REFERENCES "FluxoNo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluxoExecucao" ADD CONSTRAINT "FluxoExecucao_fluxoId_fkey" FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluxoExecucaoLog" ADD CONSTRAINT "FluxoExecucaoLog_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "FluxoExecucao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaDestinatario" ADD CONSTRAINT "CampanhaDestinatario_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "Campanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaDestinatario" ADD CONSTRAINT "CampanhaDestinatario_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_atribuidoId_fkey" FOREIGN KEY ("atribuidoId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_proprietarioId_fkey" FOREIGN KEY ("proprietarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "MarketplaceIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_autorUsuarioId_fkey" FOREIGN KEY ("autorUsuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceIncident" ADD CONSTRAINT "MarketplaceIncident_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceIncident" ADD CONSTRAINT "MarketplaceIncident_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceMsg" ADD CONSTRAINT "MarketplaceMsg_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioIntegracao" ADD CONSTRAINT "UsuarioIntegracao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmpresaSequence" ADD CONSTRAINT "EmpresaSequence_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

