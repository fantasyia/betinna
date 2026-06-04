import { lazy, Suspense, type CSSProperties } from 'react';
import { colors } from './styles';

/**
 * Markdown — render seguro de respostas LLM (MullerBot) ou notas livres.
 *
 * Lazy: react-markdown + remark-gfm pesam ~80KB. Só carregam quando primeiro
 * markdown aparece na tela. Páginas que não usam markdown ficam intocadas.
 *
 * Segurança:
 *  - react-markdown NÃO permite HTML raw por default (allowRawHtml=false)
 *  - Sanitização implícita pelo parser AST
 *  - Links: forçados a target=_blank + rel=noopener
 *  - Code blocks: apenas style + texto, sem highlight (não carrega libs extras)
 *
 * Suporta GFM (GitHub Flavored Markdown):
 *  - Tabelas
 *  - Listas com checkbox (- [ ])
 *  - Strikethrough (~~text~~)
 *  - Autolinks
 */

const ReactMarkdownLazy = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import('react-markdown'),
    import('remark-gfm'),
  ]);
  // Wrapper component que injeta plugins + componentes customizados.
  return {
    default: ({ content }: { content: string }) => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: colors.primary, textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
          p: ({ children }) => (
            <p style={{ margin: '0 0 0.5rem 0', lineHeight: 1.5 }}>{children}</p>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '0 0 0.5rem 0', paddingLeft: '1.25rem' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0 0 0.5rem 0', paddingLeft: '1.5rem' }}>{children}</ol>
          ),
          li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
          code: ({ children, className }) => {
            const inline = !className;
            if (inline) {
              return (
                <code
                  style={{
                    background: colors.bgAlt,
                    padding: '0.1rem 0.35rem',
                    borderRadius: 4,
                    fontSize: '0.92em',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  }}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre
                style={{
                  background: colors.bgAlt,
                  padding: '0.6rem 0.75rem',
                  borderRadius: 6,
                  overflowX: 'auto',
                  fontSize: 12,
                  lineHeight: 1.45,
                  margin: '0 0 0.5rem 0',
                }}
              >
                <code>{children}</code>
              </pre>
            );
          },
          blockquote: ({ children }) => (
            <blockquote
              style={{
                borderLeft: `3px solid ${colors.border}`,
                paddingLeft: '0.75rem',
                margin: '0 0 0.5rem 0',
                color: colors.muted,
                fontStyle: 'italic',
              }}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', marginBottom: '0.5rem' }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  width: '100%',
                  minWidth: 320,
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              style={{
                background: colors.bgAlt,
                padding: '0.4rem 0.6rem',
                border: `1px solid ${colors.border}`,
                textAlign: 'left',
                fontWeight: 600,
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                padding: '0.4rem 0.6rem',
                border: `1px solid ${colors.border}`,
              }}
            >
              {children}
            </td>
          ),
          h1: ({ children }) => (
            <h3 style={{ fontSize: 17, margin: '0.4rem 0', fontWeight: 700 }}>{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 style={{ fontSize: 15, margin: '0.4rem 0', fontWeight: 700 }}>{children}</h4>
          ),
          h3: ({ children }) => (
            <h5 style={{ fontSize: 14, margin: '0.4rem 0', fontWeight: 600 }}>{children}</h5>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    ),
  };
});

export function Markdown({
  content,
  style,
}: {
  content: string;
  style?: CSSProperties;
}) {
  return (
    <div style={style}>
      <Suspense
        fallback={
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{content}</p>
        }
      >
        <ReactMarkdownLazy content={content} />
      </Suspense>
    </div>
  );
}
