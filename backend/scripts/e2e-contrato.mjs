#!/usr/bin/env node
/**
 * Teste ponta a ponta do ciclo COMERCIAL, contra produção.
 *
 * Do zero: lead no funil → cliente → proposta de locação → e-mail com o link de
 * aceite → aceite do cliente → contrato montado e mandado pra assinatura →
 * assinaturas → webhook de volta → contrato assinado guardado.
 *
 * O teste é em DUAS FASES porque tem gente no meio — o cliente clica no link e
 * as pessoas assinam. Automatizar isso seria testar outra coisa.
 *
 *   node scripts/e2e-contrato.mjs --preparar   # cria e manda o e-mail
 *   node scripts/e2e-contrato.mjs --conferir   # mede onde o ciclo chegou
 *   node scripts/e2e-contrato.mjs --limpar     # apaga o que o teste criou
 *
 * Credenciais: backend/.env.local + frontend/.env.local (gitignored).
 */
import { readFileSync } from 'node:fs';
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

/** Onde o cliente do teste recebe a proposta e o contrato (e-mails do Léo). */
const EMAIL_CLIENTE = 'pedidos@somatecblocking.com.br';
const NOME_SIGNATARIO = 'Leonardo Beltran';
const NOME_CLIENTE = 'INDÚSTRIA TESTE CONTRATO LTDA (apagar)';
/** Funil "Clientes - Canal Reps" e a etapa de onde o lead parte. */
const FUNIL = 'cms56hef4005hkeapqxyt9ede';
const ETAPA_INICIAL = 'cms56hef9005kkeap6u344pcn'; // Qualificando
const ETAPAS = {
  cms56hef9005kkeap6u344pcn: 'Qualificando',
  cms56hef9005lkeap39m7cojl: 'Proposta enviada',
  cmtn1pn5z0002oebqmmbrio4k: 'Proposta assinada',
  cmtn1q1320005oebq10cumh7y: 'Contrato assinado',
  cmsfjts9u001in5aph2pd2b44: 'Instalação',
};

const acao = process.argv[2];
if (!['--preparar', '--conferir', '--limpar'].includes(acao)) {
  console.log('uso: --preparar | --conferir | --limpar');
  process.exit(1);
}

const passos = [];
const registrar = (nome, ok, detalhe = '') => {
  passos.push({ nome, ok });
  console.log(
    `${ok ? '  OK  ' : ok === null ? '  ··  ' : ' FALHA'} │ ${nome}${detalhe ? ` — ${detalhe}` : ''}`,
  );
};
const aguarda = (nome, detalhe) => {
  passos.push({ nome, ok: null });
  console.log(`  ··   │ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
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

const clickSign = async (caminho) => {
  const base = (env.CLICKSIGN_API_URL || 'https://app.clicksign.com').replace(/\/$/, '');
  const tk = (env.CLICKSIGN_ACCESS_TOKEN || '').replace(/^['"<]+|['">]+$/g, '');
  const r = await fetch(`${base}/api/v3${caminho}?access_token=${tk}`, {
    headers: { Accept: 'application/vnd.api+json' },
  });
  const t = await r.text();
  try {
    return { status: r.status, corpo: JSON.parse(t) };
  } catch {
    return { status: r.status, corpo: t.slice(0, 300) };
  }
};

console.log(`\n═══ E2E do ciclo comercial (${acao.slice(2)}) ═══\n`);

// Login + acesso direto ao banco (o teste confere estado que a API não expõe).
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: envFront.BET_EMAIL, password: envFront.BET_SENHA }),
});
token = (await login.json())?.data?.accessToken;
registrar('login no app', Boolean(token));
if (!token) process.exit(1);

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import(
  `file:///${BACKEND}/node_modules/@prisma/client/default.js`.replace(/\\/g, '/')
);
const prisma = new PrismaClient();

const empresa = await prisma.empresa.findFirst({ select: { id: true, nome: true } });

/**
 * CNPJ válido que ainda não existe na base.
 *
 * O teste cria um cliente de verdade, e o cadastro recusa CNPJ repetido — os
 * dois números "de exemplo" que se costuma usar já estavam ocupados por testes
 * anteriores. Gerar um livre é mais honesto que reaproveitar cliente alheio.
 */
const cnpjLivre = async () => {
  const dv = (base) => {
    const calc = (nums) => {
      const pesos =
        nums.length === 12
          ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
          : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const r = nums.reduce((a, n, i) => a + n * pesos[i], 0) % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const n = base.split('').map(Number);
    const d1 = calc(n);
    return `${base}${d1}${calc([...n, d1])}`;
  };
  for (let i = 0; i < 30; i++) {
    const cnpj = dv(`${String(70000000 + Math.floor(Math.random() * 9999999)).slice(0, 8)}0001`);
    const existe = await prisma.cliente.findFirst({ where: { cnpj }, select: { id: true } });
    if (!existe) return cnpj;
  }
  throw new Error('não achei CNPJ livre');
};

// ── PREPARAR ─────────────────────────────────────────────────────────
if (acao === '--preparar') {
  // 1 · cliente industrial (locação é oferta INDUSTRIAL — nunca padaria/restaurante)
  let cliente = await prisma.cliente.findFirst({
    where: { nome: NOME_CLIENTE },
    select: { id: true },
  });
  if (!cliente) {
    const r = await app('POST', '/clientes', {
      nome: NOME_CLIENTE,
      cnpj: await cnpjLivre(),
      email: EMAIL_CLIENTE,
      telefone: '11999990000',
      segmento: 'INDUSTRIA',
      cep: '01310-100',
      endereco: 'Avenida Paulista',
      numero: '1000',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
    });
    cliente = { id: r.corpo?.id };
    registrar(
      'cliente industrial de teste',
      Boolean(cliente.id),
      JSON.stringify(r.erro ?? '').slice(0, 120),
    );
  } else {
    registrar('cliente industrial de teste', true, 'reaproveitado');
  }

  // 2 · lead no funil dos reps, VINCULADO ao cliente
  //
  // O vínculo é o que faz o funil andar sozinho: os marcos resolvem o lead pelo
  // cliente da proposta. Lead solto não anda — e é bom o teste provar isso pelo
  // caminho de verdade (a tela de contatos), não por escrita direta no banco.
  if (!cliente?.id) {
    console.log('  sem cliente — nada a fazer.');
    process.exit(1);
  }
  let lead = await prisma.lead.findFirst({
    where: { clienteId: cliente.id },
    select: { id: true },
  });
  if (!lead) {
    const r = await app('POST', '/leads', {
      nome: NOME_CLIENTE,
      contatoNome: NOME_SIGNATARIO,
      contatoEmail: EMAIL_CLIENTE,
      contatoTelefone: '11999990000',
      segmento: 'INDUSTRIA',
      cidade: 'São Paulo',
      uf: 'SP',
      canalOrigem: 'OUTRO',
      funilId: FUNIL,
      funilEtapaId: ETAPA_INICIAL,
      observacoes: 'E2E do ciclo comercial — pode apagar.',
    });
    lead = { id: r.corpo?.id };
    if (lead.id)
      await app('POST', '/contatos/vincular-cliente', { leadId: lead.id, clienteId: cliente.id });
    registrar('lead no funil dos reps, ligado ao cliente', Boolean(lead.id), 'etapa Qualificando');
  } else {
    // Lead reaproveitado volta pro começo — quem move pra TRÁS é gente, e aqui
    // é exatamente isso: alguém remontando o teste. O app não faz isso sozinho
    // (webhook fora de ordem não pode rebobinar o funil), então o reset passa
    // pelo endpoint de mover etapa, como um clique no kanban.
    await app('PUT', `/leads/${lead.id}/etapa`, { funilEtapaId: ETAPA_INICIAL });
    registrar(
      'lead no funil dos reps, ligado ao cliente',
      true,
      'reaproveitado (voltou pro início)',
    );
  }

  // 3 · proposta de LOCAÇÃO com signatário e termos do contrato
  const mb = await prisma.produto.findFirst({
    where: { sku: 'MB-05' },
    select: { id: true, sku: true },
  });
  const rep = await prisma.usuario.findFirst({
    where: { role: 'REP', status: 'ATIVO' },
    select: { id: true, nome: true },
  });
  const prop = await app('POST', '/propostas', {
    clienteId: cliente.id,
    itens: [{ produtoId: mb.id, quantidade: 1, desconto: 0 }],
    formaPagamento: 'BOLETO',
    condicaoPagamento: '30dias',
    modalidade: 'LOCACAO',
    representanteId: rep?.id,
    // 36 meses e vencimento no dia 5 são o que está no modelo de contrato do
    // Léo. CARÊNCIA fica de fora: o período grátis é decisão comercial dele e
    // ainda está em aberto (60 ou 90 dias) — o teste não inventa cláusula.
    prazoMeses: 36,
    diaVencimento: 5,
    signatarioNome: NOME_SIGNATARIO,
    signatarioEmail: EMAIL_CLIENTE,
    observacoes: 'E2E do ciclo comercial — pode apagar.',
  });
  const propostaId = prop.corpo?.id;
  registrar(
    'proposta de locação (1× MB-05, 36 meses, venc. dia 5, sem carência)',
    prop.status === 201 && Boolean(propostaId),
    `${prop.corpo?.numero ?? ''} · rep ${rep?.nome ?? '—'} · ${JSON.stringify(prop.erro ?? '').slice(0, 120)}`,
  );
  if (!propostaId) process.exit(1);

  await app('PUT', `/propostas/${propostaId}/status`, { status: 'ENVIADA' });

  // 4 · O PROJETO do cliente. Sem ele a proposta não sai — e é assim que o
  // teste exercita a regra, em vez de contorná-la. Projeto de teste: uma
  // unidade, um quadro, o mínimo que prova o caminho.
  const projeto = pdfDeUmaPagina([
    'PROJETO DE INSTALACAO - TESTE',
    '',
    `Cliente: ${NOME_CLIENTE}`,
    'Quadro: QGBT-01   Tensao: 380V',
    'Equipamento: 1x Master Block MB-05',
    '',
    'Documento de teste do fluxo comercial. Sem valor tecnico.',
  ]);
  const form = new FormData();
  form.append('file', new Blob([projeto], { type: 'application/pdf' }), 'projeto-teste.pdf');
  const upload = await fetch(`${API}/propostas/${propostaId}/anexos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  registrar('projeto anexado à proposta', upload.status < 300, `${projeto.length} bytes`);

  // 5 · o e-mail com o LINK DE ACEITE (sem PDF: o link é o que fecha)
  const email = await app('POST', `/propostas/${propostaId}/enviar-email`);
  registrar(
    'e-mail da proposta enviado',
    email.status < 300,
    email.corpo?.enviadoPara ?? JSON.stringify(email.erro ?? '').slice(0, 160),
  );

  const depois = await prisma.proposta.findUnique({
    where: { id: propostaId },
    select: { numero: true, status: true, aceiteToken: true, valor: true },
  });
  const leadAgora = await prisma.lead.findFirst({
    where: { clienteId: cliente.id },
    select: { funilEtapaId: true },
  });
  registrar(
    'lead moveu pra "Proposta enviada"',
    leadAgora?.funilEtapaId === 'cms56hef9005lkeap39m7cojl',
    ETAPAS[leadAgora?.funilEtapaId] ?? leadAgora?.funilEtapaId ?? '—',
  );

  console.log(
    `\n  proposta ${depois.numero} · R$ ${Number(depois.valor).toFixed(2)} · ${depois.status}`,
  );
  console.log(`  link de aceite (o mesmo que foi por e-mail):`);
  console.log(
    `  https://frontend-production-fd70.up.railway.app/proposta/aceite/${depois.aceiteToken}\n`,
  );
  console.log('  Agora é com você: abra o link, aceite como se fosse o cliente.');
  console.log('  Depois rode:  node scripts/e2e-contrato.mjs --conferir\n');
}

/**
 * PDF de uma página, montado à mão.
 *
 * O teste precisa de um arquivo de verdade pra anexar, e trazer uma biblioteca
 * de PDF só pra isso seria dependência nova por causa de teste. São 5 objetos e
 * uma tabela de offsets — o formato é simples o bastante pra caber aqui.
 */
function pdfDeUmaPagina(linhas) {
  const NL = '\n';
  const escapar = (l) => l.replace(/[()\\]/g, (c) => `\\${c}`);
  const texto = linhas
    .map((l, i) => `BT /F1 12 Tf 60 ${760 - i * 20} Td (${escapar(l)}) Tj ET`)
    .join(NL);
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${texto.length} >>${NL}stream${NL}${texto}${NL}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = `%PDF-1.4${NL}`;
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj${NL}${o}${NL}endobj${NL}`;
  });
  const xref = pdf.length;
  pdf += `xref${NL}0 ${objetos.length + 1}${NL}0000000000 65535 f ${NL}`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n ${NL}`;
  pdf +=
    `trailer${NL}<< /Size ${objetos.length + 1} /Root 1 0 R >>${NL}` +
    `startxref${NL}${xref}${NL}%%EOF${NL}`;
  return Buffer.from(pdf, 'latin1');
}

// ── CONFERIR ─────────────────────────────────────────────────────────
if (acao === '--conferir') {
  const proposta = await prisma.proposta.findFirst({
    where: { cliente: { nome: NOME_CLIENTE } },
    orderBy: { criadoEm: 'desc' },
    select: {
      id: true,
      numero: true,
      status: true,
      valor: true,
      clienteId: true,
      aceitoEm: true,
      aceitoDoIp: true,
      signatarioNome: true,
      signatarioEmail: true,
      prazoMeses: true,
      diaVencimento: true,
      orcamentoErpId: true,
    },
  });
  if (!proposta) {
    console.log('  Nenhuma proposta de teste encontrada — rode --preparar antes.\n');
    process.exit(1);
  }
  console.log(`  proposta ${proposta.numero} · ${proposta.status}\n`);

  registrar(
    'cliente aceitou a proposta',
    proposta.status === 'ACEITA',
    proposta.aceiteEm
      ? `em ${proposta.aceiteEm.toISOString()} (ip ${proposta.aceiteIp ?? '?'})`
      : 'ainda não',
  );

  const contrato = await prisma.contrato.findFirst({
    where: { propostaId: proposta.id },
    select: {
      id: true,
      status: true,
      valorMensal: true,
      prazoMeses: true,
      diaVencimento: true,
      assinaturaId: true,
      assinaturaDocumentoId: true,
      assinadoEm: true,
      documentoUrl: true,
      contratoErpId: true,
    },
  });
  registrar(
    'contrato criado no app',
    Boolean(contrato),
    contrato ? `${contrato.status}` : 'não existe',
  );

  if (contrato) {
    registrar(
      'termos do contrato batem com a proposta',
      contrato.prazoMeses === proposta.prazoMeses &&
        contrato.diaVencimento === proposta.diaVencimento &&
        Number(contrato.valorMensal) === Number(proposta.valor),
      `R$ ${Number(contrato.valorMensal).toFixed(2)} · ${contrato.prazoMeses} meses · venc. dia ${contrato.diaVencimento}`,
    );

    // 5 · o envelope do lado do ClickSign — quem assinou, e como
    if (contrato.assinaturaId) {
      const env_ = await clickSign(`/envelopes/${contrato.assinaturaId}`);
      const st = env_.corpo?.data?.attributes?.status;
      registrar('envelope no ClickSign', env_.status === 200, `status ${st}`);
      // Quem diz se assinaram é o ENVELOPE (`closed` = fechado, todos
      // assinaram). O signatário NÃO traz `signed_at` nos atributos — a
      // primeira versão deste teste checava esse campo e acusava "ainda não"
      // com o contrato já assinado. Falso alarme custa mais caro que teste
      // nenhum: ensina a ignorar o vermelho.
      registrar('todos assinaram (envelope fechado)', st === 'closed', `status ${st}`);
      const signers = await clickSign(`/envelopes/${contrato.assinaturaId}/signers`);
      for (const s of signers.corpo?.data ?? []) {
        console.log(`         · ${s.attributes?.name} <${s.attributes?.email}>`);
      }
    }

    registrar(
      'webhook fechou o contrato',
      contrato.status === 'ASSINADO',
      contrato.assinadoEm ? `assinado em ${contrato.assinadoEm.toISOString()}` : 'aguardando',
    );
    registrar(
      'PDF assinado guardado no Storage',
      Boolean(contrato.documentoUrl),
      contrato.documentoUrl ?? '—',
    );
    if (contrato.status === 'ASSINADO' && !contrato.contratoErpId) {
      aguarda(
        'contrato como OBJETO no ERP (/contratos#list)',
        'não implementado — é a API v2, item E1. O orçamento pro Leandro já sobe.',
      );
    }
  }

  // Depois de assinado o ciclo continua sozinho: a proposta sobe pro ERP como
  // orçamento (é o que o Leandro revisa) e o pedido do aceite TRAVA.
  if (contrato?.status === 'ASSINADO') {
    registrar(
      'proposta subiu pro ERP como orçamento',
      Boolean(proposta.orcamentoErpId),
      proposta.orcamentoErpId ?? 'ainda não',
    );
  }

  const lead = await prisma.lead.findFirst({
    where: { clienteId: proposta.clienteId },
    select: { id: true, funilEtapaId: true },
  });
  registrar(
    'lead no funil',
    Boolean(lead),
    ETAPAS[lead?.funilEtapaId] ?? lead?.funilEtapaId ?? 'sem lead',
  );

  const historico = await prisma.leadEtapaHistorico.findMany({
    where: { leadId: lead?.id ?? '—' },
    orderBy: { ocorridoEm: 'asc' },
    select: { etapaOrigem: true, etapaDestino: true, origemMudanca: true, ocorridoEm: true },
  });
  if (historico.length) {
    console.log('\n  trajetória do lead:');
    for (const h of historico) {
      console.log(
        `    ${h.ocorridoEm.toISOString().slice(11, 19)}  ${ETAPAS[h.etapaOrigem] ?? h.etapaOrigem ?? '∅'} → ` +
          `${ETAPAS[h.etapaDestino] ?? h.etapaDestino} (${h.origemMudanca})`,
      );
    }
  }

  const pedido = await prisma.pedido.findFirst({
    where: { propostaNumero: proposta.numero },
    select: { numero: true, status: true, numeroErp: true, total: true, representanteId: true },
  });
  if (pedido) {
    registrar(
      'pedido travado esperando a liberação no ERP',
      contrato?.status === 'ASSINADO'
        ? pedido.status === 'AGUARDANDO_LIBERACAO'
        : pedido.status === 'RASCUNHO',
      pedido.status,
    );
    console.log(
      `\n  pedido gerado no aceite: ${pedido.numero} · ${pedido.status} · R$ ${Number(pedido.total).toFixed(2)}` +
        ` · ERP ${pedido.numeroErp ?? '—'} · rep ${pedido.representanteId ? 'sim' : 'não'}`,
    );
  }

  const ok = passos.filter((p) => p.ok === true).length;
  const falhou = passos.filter((p) => p.ok === false).length;
  console.log(`\n  ${ok} conferidos · ${falhou} pendentes/falhos\n`);
}

// ── LIMPAR ───────────────────────────────────────────────────────────
if (acao === '--limpar') {
  const props = await prisma.proposta.findMany({
    where: { cliente: { nome: NOME_CLIENTE } },
    select: { id: true, numero: true },
  });
  for (const p of props) {
    const r = await app('DELETE', `/propostas/${p.id}`);
    registrar(
      `proposta ${p.numero} apagada`,
      r.status < 300,
      JSON.stringify(r.erro ?? '').slice(0, 120),
    );
  }
  const cliente = await prisma.cliente.findFirst({
    where: { nome: NOME_CLIENTE },
    select: { id: true },
  });
  if (cliente) {
    const leads = await prisma.lead.findMany({
      where: { clienteId: cliente.id },
      select: { id: true },
    });
    for (const l of leads) {
      const r = await app('DELETE', `/leads/${l.id}`);
      registrar(`lead ${l.id} apagado`, r.status < 300);
    }
  }
  console.log('\n  O cliente e os pedidos ficam — apague na tela se quiser.\n');
}

await prisma.$disconnect();
