#!/usr/bin/env node
/**
 * Teste ponta a ponta da integração com o ERP (Tiny/Olist), contra PRODUÇÃO.
 *
 * Exercita o caminho inteiro do representante: catálogo sincronizado → proposta
 * no app → orçamento no ERP → aprovação → pedido de venda → volta pro app com
 * dono e comissão → cancelamento propagando. No fim limpa o que criou.
 *
 * Uso:  node scripts/e2e-erp.mjs --executar
 *
 * O flag é proposital: o teste CRIA objetos no ERP de verdade (orçamento e
 * pedido) e depois os cancela/exclui. Rodar sem querer polui o ERP do cliente.
 *
 * Credenciais saem de backend/.env.local (BET_EMAIL/BET_SENHA vêm do
 * frontend/.env.local, que é onde já moram).
 */
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(AQUI, '..');
const FRONTEND = join(BACKEND, '..', 'frontend');

const lerEnv = (caminho) =>
  Object.fromEntries(
    readFileSync(caminho, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        let v = l.slice(i + 1).trim();
        const m = /^(['"])([\s\S]*)\1$/.exec(v);
        if (m) v = m[2];
        return [l.slice(0, i).trim(), v];
      }),
  );

const env = lerEnv(join(BACKEND, '.env.local'));
const envFront = lerEnv(join(FRONTEND, '.env.local'));
const API = env.E2E_API_URL ?? 'https://api-production-9426.up.railway.app/api/v1';

if (!process.argv.includes('--executar')) {
  console.log('Este teste cria objetos REAIS no ERP. Rode com --executar pra confirmar.');
  process.exit(1);
}

// ── infra ────────────────────────────────────────────────────────────
const passos = [];
const registrar = (nome, ok, detalhe = '') => {
  passos.push({ nome, ok, detalhe });
  console.log(`${ok ? '  OK  ' : ' FALHA'} │ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera uma condição VIRAR verdadeira, em vez de dormir um tempo fixo.
 *
 * Sleep fixo é o que torna teste de integração instável: na 3ª rodada de 03/09 o
 * ERP levou um instante a mais pra refletir o cancelamento e o teste leu antes,
 * acusando falha onde não havia. Esperar a convergência é honesto — se nunca
 * convergir, aí sim é defeito, e o teste falha por tempo esgotado.
 */
const ateQue = async (descricao, tentar, { tentativas = 10, intervalo = 3000 } = {}) => {
  for (let i = 1; i <= tentativas; i++) {
    const r = await tentar(i);
    if (r) return r;
    if (i < tentativas) await dormir(intervalo);
  }
  console.log(`        (esgotou a espera de "${descricao}" após ${tentativas} tentativas)`);
  return null;
};

let token;
const app = async (metodo, rota, corpo) => {
  const r = await fetch(API + rota, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t.slice(0, 300);
  }
  return { status: r.status, corpo: j?.data ?? j, erro: j?.error };
};

/** Acesso direto ao ERP (v3), com o token da conexão do tenant. */
const decifrar = (b64) => {
  const d = Buffer.from(b64, 'base64');
  const c = createDecipheriv('aes-256-gcm', Buffer.from(env.ENCRYPTION_KEY, 'hex'), d.subarray(0, 12));
  c.setAuthTag(d.subarray(d.length - 16));
  return Buffer.concat([c.update(d.subarray(12, d.length - 16)), c.final()]).toString('utf8');
};
let erpToken;
const erp = async (metodo, caminho, corpo) => {
  const r = await fetch(`https://api.tiny.com.br/public-api/v3${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${erpToken}`,
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t.slice(0, 300);
  }
  return { status: r.status, corpo: j };
};

// ── execução ─────────────────────────────────────────────────────────
const criado = { propostaId: null, orcamentoId: null, pedidoErpId: null };

async function principal() {
  console.log('\n═══ E2E ERP (Tiny/Olist) ═══\n');

  // 0 · autenticação no app
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: envFront.BET_EMAIL, password: envFront.BET_SENHA }),
  });
  token = (await login.json())?.data?.accessToken;
  registrar('login no app', Boolean(token));
  if (!token) return;

  // token do ERP direto do banco, pra falar com o Tiny sem passar pelo app
  process.env.DATABASE_URL = env.DATABASE_URL;
  const { PrismaClient } = await import(`file:///${BACKEND}/node_modules/@prisma/client/default.js`.replace(/\\/g, '/'));
  const prisma = new PrismaClient();
  const conexao = await prisma.integracaoConexao.findFirst({ where: { servico: 'tiny', ativo: true } });
  erpToken = JSON.parse(decifrar(conexao.credenciais)).accessToken;

  // 1 · conexão viva com o ERP
  const ping = await erp('GET', '/produtos?limit=1');
  registrar('conexão com o ERP', ping.status === 200, `HTTP ${ping.status}`);

  // 2 · sync de produtos sem erro e sem imagem perdida
  const sync = await app('POST', '/integracoes/tiny/sync/produtos?modo=completo');
  const s = sync.corpo ?? {};
  registrar(
    'sync de produtos',
    sync.status < 300 && s.erros === 0 && (s.imagensFalharam ?? 0) === 0,
    `lidos=${s.lidos} erros=${s.erros} imagensFalharam=${s.imagensFalharam}`,
  );

  // 3 · catálogo íntegro no app: 36 Master Block, todos com mensalidade
  const mbs = await prisma.produto.findMany({
    where: { sku: { startsWith: 'MB-' } },
    select: { sku: true, precoLocacaoMensal: true, ativo: true },
  });
  const semMensalidade = mbs.filter((p) => !p.precoLocacaoMensal || Number(p.precoLocacaoMensal) <= 0);
  registrar(
    'catálogo: 36 Master Block com mensalidade',
    mbs.length === 36 && semMensalidade.length === 0,
    `${mbs.length} produtos, ${semMensalidade.length} sem mensalidade`,
  );

  // 4 · estoque desceu
  const comEstoque = (s.estoqueAtualizado ?? 0) >= 36;
  registrar('estoque sincronizado', comEstoque, `${s.estoqueAtualizado} produtos`);

  // 5 · proposta de LOCAÇÃO no app, com os termos do contrato
  //
  // Cliente PRÓPRIO do teste, com nome industrial explícito. Pegar "o primeiro
  // cliente ativo" trazia padaria/restaurante — e locação é oferta INDUSTRIAL
  // (regra do Léo, 03/09). Exemplo errado no teste vira desenho errado depois.
  const NOME_TESTE = 'INDÚSTRIA TESTE E2E LTDA (apagar)';
  let cliente = await prisma.cliente.findFirst({
    where: { nome: NOME_TESTE },
    select: { id: true, nome: true },
  });
  if (!cliente) {
    const criadoCliente = await app('POST', '/clientes', {
      nome: NOME_TESTE,
      cnpj: '19.131.243/0001-97',
      email: 'e2e@example.com',
      telefone: '11999990000',
      cidade: 'São Paulo',
      uf: 'SP',
    });
    cliente = { id: criadoCliente.corpo?.id, nome: NOME_TESTE };
  }
  const mb01 = await prisma.produto.findFirst({ where: { sku: 'MB-01' }, select: { id: true } });
  const rep = await prisma.usuario.findFirst({ where: { role: 'REP', status: 'ATIVO' }, select: { id: true } });
  const prop = await app('POST', '/propostas', {
    clienteId: cliente.id,
    itens: [{ produtoId: mb01.id, quantidade: 2, desconto: 0 }],
    formaPagamento: 'BOLETO',
    condicaoPagamento: '30dias',
    descontoGeral: 0,
    probabilidade: 50,
    modalidade: 'LOCACAO',
    representanteId: rep.id,
    prazoMeses: 36,
    diaVencimento: 5,
    carenciaDias: 60,
    observacoes: 'E2E automatizado — pode apagar.',
  });
  criado.propostaId = prop.corpo?.id;
  const termosOk =
    prop.corpo?.prazoMeses === 36 && prop.corpo?.diaVencimento === 5 && prop.corpo?.carenciaDias === 60;
  registrar('proposta de locação com termos de contrato', prop.status === 201 && termosOk, prop.corpo?.numero);

  await app('PUT', `/propostas/${criado.propostaId}/status`, { status: 'ENVIADA' });

  // 6 · sobe pro ERP como orçamento, com vendedor
  const envio = await app('POST', `/propostas/${criado.propostaId}/enviar-erp`);
  criado.orcamentoId = envio.corpo?.orcamentoErpId;
  registrar(
    'proposta → orçamento no ERP (com vendedor)',
    envio.status === 201 && Boolean(criado.orcamentoId) && Boolean(envio.corpo?.vendedorErpId),
    `orçamento ${criado.orcamentoId} · vendedor ${envio.corpo?.vendedorErpId}`,
  );

  // 7 · aprovação (o passo do Leandro)
  const aprovar = await erp('PUT', `/orcamentos/${criado.orcamentoId}/situacao`, { situacao: 'Aprovado' });
  await dormir(1500);
  const depois = await erp('GET', `/orcamentos/${criado.orcamentoId}`);
  registrar(
    'aprovação do orçamento',
    aprovar.status === 204 && depois.corpo?.situacao === 'Aprovado',
    `situação ${depois.corpo?.situacao}`,
  );

  // 8 · orçamento aprovado vira pedido de venda
  const venda = await erp('POST', `/orcamentos/${criado.orcamentoId}/venda`, {});
  criado.pedidoErpId = venda.corpo?.id;
  registrar(
    'orçamento → pedido de venda',
    venda.status === 201 && Boolean(criado.pedidoErpId),
    `pedido ${venda.corpo?.numeroPedido}`,
  );

  // 9 · o pedido gerado carrega o VENDEDOR (sem isso a comissão não calcula)
  await dormir(1500);
  const pedidoErp = await erp('GET', `/pedidos/${criado.pedidoErpId}`);
  registrar(
    'pedido gerado carrega o vendedor',
    Boolean(pedidoErp.corpo?.vendedor?.id),
    pedidoErp.corpo?.vendedor?.nome ?? 'sem vendedor',
  );

  // 10 · desce pro app com dono e comissão
  const numeroErp = String(pedidoErp.corpo?.numeroPedido);
  const noApp = await ateQue('pedido aparecer no app', async () => {
    await app('POST', '/pedidos/sync-erp');
    const p = await prisma.pedido.findFirst({
      where: { numeroErp },
      select: { numero: true, representanteId: true, comissao: true, total: true, status: true },
    });
    return p?.representanteId ? p : null;
  });
  registrar(
    'pedido desce pro app com dono e comissão',
    Boolean(noApp?.representanteId) && Number(noApp?.comissao) > 0,
    `${noApp?.numero} · R$ ${noApp?.total} · comissão R$ ${noApp?.comissao}`,
  );

  // 11 · cancelamento no ERP propaga pro app
  //
  // Duas esperas, e cada uma prova uma coisa: primeiro que o ERP (a fonte da
  // verdade) realmente mudou, depois que o app alcançou. Sincronizar antes de o
  // ERP refletir faria o teste medir a própria pressa.
  await erp('PUT', `/pedidos/${criado.pedidoErpId}/situacao`, { situacao: 2 });
  const noErp = await ateQue('ERP marcar como cancelado', async () => {
    const p = await erp('GET', `/pedidos/${criado.pedidoErpId}`);
    return p.corpo?.situacao === 2 ? p : null;
  }, { tentativas: 6, intervalo: 2000 });
  const cancelado = noErp
    ? await ateQue('app refletir o cancelamento', async () => {
        await app('POST', '/pedidos/sync-erp');
        const p = await prisma.pedido.findFirst({ where: { numeroErp }, select: { status: true } });
        return p?.status === 'CANCELADO' ? p : null;
      })
    : null;
  registrar(
    'cancelamento propaga pro app',
    cancelado?.status === 'CANCELADO',
    noErp ? (cancelado?.status ?? 'app não alcançou') : 'ERP não cancelou',
  );

  // 12 · limpeza: não deixa lixo pra trás
  //
  // A proposta é APAGADA, não marcada como recusada: proposta de teste marcada
  // recusada aparece no funil como negócio perdido — número errado no lugar
  // mais visível que existe.
  const delOrc = await erp('DELETE', `/orcamentos/${criado.orcamentoId}`);
  const delProp = await app('DELETE', `/propostas/${criado.propostaId}`);
  registrar(
    'limpeza (orçamento e proposta apagados)',
    delOrc.status === 204 && delProp.status < 300,
    `orçamento ${delOrc.status} · proposta ${delProp.status}`,
  );

  await prisma.$disconnect();
}

principal()
  .catch((e) => registrar('execução sem exceção', false, String(e.message).slice(0, 200)))
  .finally(() => {
    const ok = passos.filter((p) => p.ok).length;
    const nota = ((ok / passos.length) * 10).toFixed(1);
    console.log(`\n═══ ${ok}/${passos.length} passos · NOTA ${nota} ═══\n`);
    process.exit(ok === passos.length ? 0 : 1);
  });
