/**
 * Admin panel — apenas ADMIN. Sprint 4 FIX 6 / FIX 7.
 */
export default function AdminPage() {
  return (
    <div data-testid="admin-page" style={{ padding: '2rem' }}>
      <h1>Admin Panel</h1>
      <p>Gerenciamento global da plataforma (ADMIN only)</p>
      <ul>
        <li><a href="/admin/users">Usuários</a></li>
        <li><a href="/admin/dead-letter">Dead Letter Queue</a></li>
        <li><a href="/admin/empresas">Empresas</a></li>
      </ul>
    </div>
  );
}
