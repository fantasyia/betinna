/**
 * Política de Privacidade da vitrine — texto montado POR EMPRESA (puro).
 *
 * Pedido do Léo (09/10, card da #04): o Meta não libera formulário de anúncio
 * sem a política publicada no domínio da vitrine. O texto é jurídico e tem que
 * ser VERDADEIRO pra cada empresa: cada parte só aparece se a empresa usa
 * aquilo (pagamento online → Asaas; frete → Melhor Envio; automação ligada →
 * assistente com IA). Quem responde pelos dados (controlador) e o canal de
 * contato vêm da configuração da empresa, nunca de valor fixo aqui.
 *
 * Mudou o que a empresa usa (ligou o pixel, trocou de gateway)? O texto muda
 * sozinho — e a data de "atualizada em" é a do último salvamento da config.
 */

export interface DadosPolitica {
  /** Razão social de quem responde pelos dados. */
  controlador: string;
  /** Nome que o cliente conhece (marca). */
  marca: string;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  /** Canal pra pedidos de titular (LGPD art. 18). */
  email: string;
  /** Data (AAAA-MM-DD) da última atualização. */
  atualizadaEm: string;
  usa: {
    /** Pagamento online (Pix/cartão) pelo Asaas. */
    pagamentoOnline: boolean;
    /** Frete cotado no Melhor Envio. */
    frete: boolean;
    /** Respostas automáticas (fluxos/IA) no WhatsApp. */
    assistenteIa: boolean;
  };
}

export interface Secao {
  titulo: string;
  paragrafos: string[];
  itens?: string[];
}

export interface Politica {
  titulo: string;
  marca: string;
  atualizadaEm: string;
  secoes: Secao[];
}

const formatarCnpj = (v: string): string => {
  const d = v.replace(/\D/g, '');
  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : v;
};

const dataBr = (iso: string): string => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
};

export function politicaDePrivacidade(x: DadosPolitica): Politica {
  const local = [x.cidade, x.uf].filter(Boolean).join('/');
  const quem = [x.controlador, x.cnpj ? `CNPJ ${formatarCnpj(x.cnpj)}` : null, local || null]
    .filter(Boolean)
    .join(', ');

  const coleta: string[] = [
    'Ao enviar um pedido na vitrine: nome ou nome da loja, número de WhatsApp, CPF ou CNPJ (opcional), cidade e UF, os produtos e as quantidades do pedido.',
  ];
  if (x.usa.frete) {
    coleta.push('Quando o pedido tem entrega: CEP, endereço, número, complemento e bairro.');
  }
  if (x.usa.pagamentoOnline) {
    coleta.push(
      'Ao pagar online: CPF ou CNPJ e os dados da cobrança (Pix ou cartão). Os dados do cartão são digitados no ambiente do processador de pagamento e não ficam guardados conosco.',
    );
  }
  coleta.push(
    'Em formulários de anúncios do Facebook e do Instagram (Meta): os dados que você preenche no formulário, como nome, telefone, e-mail e respostas às perguntas.',
    'Em conversas pelo WhatsApp: o seu número, o nome do seu perfil e as mensagens trocadas com o nosso atendimento.',
    'No seu aparelho: a vitrine guarda no navegador o pedido em montagem e os seus dados de contato e entrega, para você não precisar digitar de novo. Isso fica só no seu aparelho e você pode apagar limpando os dados do navegador.',
    'Dados técnicos: registros de erro e de acesso (como endereço IP, navegador e horário), usados para manter o site funcionando e seguro.',
  );

  const finalidades: string[] = [
    'Receber, conferir e atender o seu pedido, inclusive confirmar itens, preços e prazos com você (execução de contrato e procedimentos preliminares).',
    'Responder o seu contato e enviar informações sobre pedidos e produtos que você pediu (legítimo interesse e execução de contrato).',
  ];
  if (x.usa.pagamentoOnline) finalidades.push('Processar o pagamento (execução de contrato).');
  if (x.usa.frete) {
    finalidades.push('Calcular o frete e entregar o pedido (execução de contrato).');
  }
  finalidades.push(
    'Atender contatos que chegam por anúncios no Facebook e no Instagram (consentimento dado no próprio formulário e legítimo interesse).',
    'Cumprir obrigações legais e fiscais e exercer direitos em processos (cumprimento de obrigação legal e exercício regular de direitos).',
    'Manter a segurança do site e evitar fraudes (legítimo interesse).',
  );

  const compartilha: string[] = [
    'Meta (Facebook, Instagram e WhatsApp): quando você fala conosco pelo WhatsApp ou preenche um formulário de anúncio, a Meta trata esses dados conforme a política dela.',
  ];
  if (x.usa.assistenteIa) {
    compartilha.push(
      'Provedor de inteligência artificial: usamos um assistente automático para responder mensagens. O conteúdo da conversa é processado por um provedor de IA contratado, só para gerar a resposta.',
    );
  }
  if (x.usa.pagamentoOnline) {
    compartilha.push(
      'Asaas (instituição de pagamento): recebe os dados necessários para gerar e processar a cobrança.',
    );
  }
  if (x.usa.frete) {
    compartilha.push(
      'Melhor Envio e transportadoras: recebem CEP, endereço e dados de contato para cotar e entregar o pedido.',
    );
  }
  compartilha.push(
    'Fornecedores de tecnologia que hospedam e operam a vitrine e o nosso sistema de atendimento, sob obrigação de confidencialidade.',
    'Autoridades públicas, quando a lei exigir.',
  );

  const secoes: Secao[] = [
    {
      titulo: 'Quem somos',
      paragrafos: [
        `Esta política explica como ${x.marca} trata os seus dados pessoais na vitrine de atacado, nos anúncios e no atendimento pelo WhatsApp, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).`,
        `Quem responde pelos dados (controlador): ${quem}. Contato para assuntos de privacidade: ${x.email}.`,
      ],
    },
    { titulo: 'Quais dados coletamos', paragrafos: [], itens: coleta },
    { titulo: 'Para que usamos', paragrafos: [], itens: finalidades },
    {
      titulo: 'Com quem compartilhamos',
      paragrafos: ['Não vendemos os seus dados. Compartilhamos só o necessário com:'],
      itens: compartilha,
    },
    {
      titulo: 'Transferência para fora do Brasil',
      paragrafos: [
        'Alguns desses fornecedores (como a Meta e provedores de tecnologia) guardam ou processam dados em outros países. Nesses casos, a transferência segue o que a LGPD permite, com fornecedores que adotam medidas de proteção adequadas.',
      ],
    },
    {
      titulo: 'Por quanto tempo guardamos',
      paragrafos: [
        'Guardamos os dados enquanto houver relação comercial com você e, depois, pelo tempo que a lei exigir (por exemplo, registros fiscais e de pedidos) ou que seja necessário para exercer direitos. Depois disso, os dados são apagados ou anonimizados.',
      ],
    },
    {
      titulo: 'Seus direitos',
      paragrafos: [`Você pode pedir, a qualquer momento, pelo e-mail ${x.email}:`],
      itens: [
        'confirmação de que tratamos os seus dados e acesso a eles;',
        'correção de dados incompletos, errados ou desatualizados;',
        'anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desacordo com a lei;',
        'portabilidade dos dados a outro fornecedor;',
        'eliminação dos dados tratados com base no seu consentimento e revogação desse consentimento;',
        'informação sobre com quem compartilhamos os seus dados.',
      ],
    },
    {
      titulo: 'Não quer mais receber mensagens?',
      paragrafos: [
        // Sem promessa de bloqueio AUTOMÁTICO: depende da tag LGPD existir na
        // empresa (na Ribelt Têxtil, em 09/10, não existia). Quem atende é gente.
        'Peça ao nosso atendimento, pelo WhatsApp ou pelo e-mail acima, para não receber mais mensagens comerciais. O pedido é atendido sem custo e não afeta pedidos que você já fez.',
      ],
    },
    {
      titulo: 'Segurança',
      paragrafos: [
        'Usamos conexão criptografada (HTTPS), controle de acesso por usuário e senha e registros de acesso para proteger os seus dados. Nenhum sistema é totalmente imune a incidentes; se acontecer algum que possa causar risco relevante, avisamos você e a Autoridade Nacional de Proteção de Dados, como manda a lei.',
      ],
    },
    {
      titulo: 'Mudanças nesta política',
      paragrafos: [
        `Esta política pode ser atualizada quando mudarmos a forma de tratar dados. A versão em vigor é sempre a publicada nesta página. Última atualização: ${dataBr(x.atualizadaEm)}.`,
      ],
    },
  ];

  return {
    titulo: `Política de Privacidade · ${x.marca}`,
    marca: x.marca,
    atualizadaEm: x.atualizadaEm,
    secoes,
  };
}
