import type {
  OmieCliente,
  OmieIncluirPedidoResponse,
  OmieListarClientesResponse,
  OmieListarProdutosResponse,
  OmieProduto,
} from './omie.types';

/**
 * Dados mockados realistas para `OMIE_DEMO_MODE=true`.
 * Permite desenvolver e testar sem credenciais reais.
 *
 * NÃO use em produção. Coloque OMIE_DEMO_MODE=false quando plugar credenciais.
 */

const CLIENTES_DEMO: OmieCliente[] = [
  {
    codigo_cliente_omie: 1001,
    codigo_cliente_integracao: 'DEMO-CLI-1001',
    razao_social: 'Restaurante Sabor Brasil LTDA',
    nome_fantasia: 'Sabor Brasil',
    cnpj_cpf: '12.345.678/0001-90',
    email: 'contato@saborbrasil.com.br',
    telefone1_ddd: '19',
    telefone1_numero: '98765-4321',
    endereco: 'Av. das Cerejeiras, 1500',
    cidade: 'Campinas',
    estado: 'SP',
    cep: '13000-000',
    bloqueado: 'N',
    inativo: 'N',
  },
  {
    codigo_cliente_omie: 1002,
    codigo_cliente_integracao: 'DEMO-CLI-1002',
    razao_social: 'Padaria Nova Era ME',
    nome_fantasia: 'Padaria Nova Era',
    cnpj_cpf: '23.456.789/0001-12',
    email: 'pedidos@novaera.com.br',
    telefone1_ddd: '11',
    telefone1_numero: '97654-3210',
    cidade: 'São Paulo',
    estado: 'SP',
    bloqueado: 'N',
    inativo: 'N',
  },
  {
    codigo_cliente_omie: 1003,
    codigo_cliente_integracao: 'DEMO-CLI-1003',
    razao_social: 'Atacadão do Povo Comercial LTDA',
    nome_fantasia: 'Atacadão do Povo',
    cnpj_cpf: '34.567.890/0001-23',
    email: 'compras@atacadaodopovo.com.br',
    cidade: 'Sorocaba',
    estado: 'SP',
    bloqueado: 'S', // este cliente está bloqueado
    inativo: 'N',
  },
];

const PRODUTOS_DEMO: OmieProduto[] = [
  {
    codigo_produto: 2001,
    codigo: 'OLE-GIR-5L',
    descricao: 'Óleo de Girassol 5L',
    descricao_detalhada: 'Óleo de girassol refinado 5 litros',
    marca: 'Soya',
    unidade: 'UN',
    valor_unitario: 48.0,
    estoque_minimo: 50,
    quantidade_estoque: 124,
    inativo: 'N',
  },
  {
    codigo_produto: 2002,
    codigo: 'AZE-EXT-500',
    descricao: 'Azeite Extra Virgem 500ml',
    descricao_detalhada: 'Azeite extra virgem importado, garrafa de 500ml',
    marca: 'Borges',
    unidade: 'UN',
    valor_unitario: 42.5,
    estoque_minimo: 30,
    quantidade_estoque: 88,
    inativo: 'N',
  },
  {
    codigo_produto: 2003,
    codigo: 'FAR-TRI-1K',
    descricao: 'Farinha de Trigo Tipo 1 1kg',
    marca: 'Dona Benta',
    unidade: 'UN',
    valor_unitario: 6.9,
    estoque_minimo: 100,
    quantidade_estoque: 340,
    inativo: 'N',
  },
];

export class OmieDemo {
  listarClientes(pagina: number): OmieListarClientesResponse {
    return {
      pagina,
      total_de_paginas: 1,
      registros: CLIENTES_DEMO.length,
      total_de_registros: CLIENTES_DEMO.length,
      clientes_cadastro: CLIENTES_DEMO,
    };
  }

  listarProdutos(pagina: number): OmieListarProdutosResponse {
    return {
      pagina,
      total_de_paginas: 1,
      registros: PRODUTOS_DEMO.length,
      total_de_registros: PRODUTOS_DEMO.length,
      produto_servico_cadastro: PRODUTOS_DEMO,
    };
  }

  incluirPedido(): OmieIncluirPedidoResponse {
    // Simula um número de pedido aleatório no OMIE
    const numero = Math.floor(100_000 + Math.random() * 900_000);
    return {
      codigo_pedido: numero,
      codigo_pedido_integracao: `DEMO-PED-${numero}`,
      codigo_status: '0',
      descricao_status: 'Pedido incluído com sucesso',
      numero_pedido: numero.toString(),
    };
  }
}
