import { Link } from 'react-router-dom';

/**
 * /403 — Acesso negado por role/permission. Sprint 4 FIX 6.
 */
export default function ForbiddenPage() {
  return (
    <div
      data-testid="forbidden-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <h1 style={{ fontSize: '4rem', margin: 0 }}>403</h1>
      <p style={{ color: '#666', maxWidth: 380, marginBottom: '1.5rem' }}>
        Você não tem permissão para acessar esta página. Se acha que isso é
        um erro, entre em contato com o admin da sua empresa.
      </p>
      <Link
        to="/dashboard"
        style={{
          padding: '0.5rem 1.5rem',
          background: '#7c3aed',
          color: 'white',
          textDecoration: 'none',
          borderRadius: 4,
        }}
      >
        Voltar ao dashboard
      </Link>
    </div>
  );
}
