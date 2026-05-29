/**
 * Tipos da API OMIE.
 *
 * A API OMIE é REST com peculiaridades:
 *  - POST único para todas operações de um recurso
 *  - Body: `{ call, app_key, app_secret, param: [{...}] }`
 *  - Erros vêm como `{ faultstring, faultcode }`
 *  - Datas no formato `dd/mm/aaaa`
 *  - Paginação: `pagina` (1-indexed) + `total_de_paginas`
 *
 * Documentação: https://developer.omie.com.br/service-list/
 */

export interface OmieRequestEnvelope<TParam = unknown> {
  call: string;
  app_key: string;
  app_secret: string;
  param: TParam[];
}

export interface OmieFault {
  faultstring: string;
  faultcode: string;
}

export interface OmiePaginationParams {
  pagina: number;
  registros_por_pagina: number;
  apenas_importado_api?: 'S' | 'N';
}

export interface OmiePaginationResponse {
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
}

// ─── CLIENTES ────────────────────────────────────────────────────────────
// Endpoint: /geral/clientes/  call: ListarClientes | IncluirCliente | AlterarCliente

export interface OmieCliente {
  codigo_cliente_omie?: number;
  codigo_cliente_integracao?: string;
  razao_social: string;
  cnpj_cpf?: string;
  nome_fantasia?: string;
  email?: string;
  telefone1_ddd?: string;
  telefone1_numero?: string;
  endereco?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  /** "S" = bloqueado, "N" = ativo */
  bloqueado?: 'S' | 'N';
  inativo?: 'S' | 'N';
  inscricao_estadual?: string;
  tags?: Array<{ tag: string }>;
  /** Data da última alteração no OMIE. Formato "dd/MM/yyyy" ou "dd/MM/yyyy HH:mm:ss". */
  data_alteracao?: string;
  hora_alteracao?: string;
  /** Algumas versões da API expõem em campo dedicado info.dAlt. Mantemos opcional. */
  info?: { dAlt?: string; hAlt?: string };
}

export interface OmieListarClientesResponse extends OmiePaginationResponse {
  clientes_cadastro: OmieCliente[];
}

// ─── PRODUTOS ────────────────────────────────────────────────────────────
// Endpoint: /geral/produtos/  call: ListarProdutos | IncluirProduto

export interface OmieProduto {
  codigo_produto?: number;
  codigo: string; // SKU
  codigo_produto_integracao?: string;
  descricao: string;
  descricao_detalhada?: string;
  marca?: string;
  ncm?: string;
  unidade?: string;
  valor_unitario: number;
  estoque_minimo?: number;
  quantidade_estoque?: number;
  inativo?: 'S' | 'N';
  /** Data da última alteração no OMIE. Formato "dd/MM/yyyy" ou "dd/MM/yyyy HH:mm:ss". */
  data_alteracao?: string;
  /** Hora da última alteração (algumas APIs retornam separado). */
  hora_alteracao?: string;
}

export interface OmieListarProdutosResponse extends OmiePaginationResponse {
  produto_servico_cadastro: OmieProduto[];
}

// ─── PEDIDOS ─────────────────────────────────────────────────────────────
// Endpoint: /produtos/pedido/  call: IncluirPedido | ConsultarPedido

export interface OmiePedidoCabecalho {
  codigo_cliente: number;
  codigo_pedido_integracao?: string;
  data_previsao: string; // dd/mm/aaaa
  etapa?: string;
  numero_pedido?: string;
  quantidade_itens: number;
}

export interface OmiePedidoItem {
  ide: { codigo_item_integracao?: string };
  produto: {
    codigo_produto?: number;
    codigo_produto_integracao?: string;
    quantidade: number;
    valor_unitario: number;
    percentual_desconto?: number;
    /** CFOP do item. Em remessa de amostra grátis: "5911" (mesma UF) ou "6911" (interestadual). */
    cfop?: string;
  };
  observacao?: { obs_item?: string };
}

export interface OmiePedidoInfoCadastro {
  cancelado?: 'S' | 'N';
  faturado?: 'S' | 'N';
  data_inclusao?: string;
}

export interface OmieIncluirPedidoParam {
  cabecalho: OmiePedidoCabecalho;
  det: OmiePedidoItem[];
  informacoes_adicionais?: {
    codigo_categoria?: string;
    codigo_conta_corrente?: number;
    consumidor_final?: 'S' | 'N';
    enviar_email?: 'S' | 'N';
    /**
     * Cenário fiscal do OMIE. Em remessa de amostra grátis aponta pra um cenário
     * "sem destaque de tributos" cadastrado na conta OMIE do cliente. Opcional:
     * sem ele, o OMIE aplica a tributação padrão do produto + CFOP informado.
     */
    codigo_cenario_imposto?: number;
  };
  observacoes?: {
    obs_venda?: string;
  };
}

export interface OmieIncluirPedidoResponse {
  codigo_pedido: number;
  codigo_pedido_integracao?: string;
  codigo_status: string;
  descricao_status: string;
  numero_pedido?: string;
}
