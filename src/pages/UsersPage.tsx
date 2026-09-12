import { useEffect, useState } from "react";
import { Eye, KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, TriangleAlert, UserCog, UsersRound } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Modal } from "../components/Modal";
import { Button, Field, Select, StatusBadge } from "../components/Ui";

type User = { id: number; full_name: string; email: string; role_id: number; role_name: string; student_id: number | null; student_name: string | null; student_number: string | null; is_active: number; password_must_change: number; last_login_at: string | null };
type Role = { id: number; name: string; description: string; permission_count: number; is_active: number };
type StudentCredentials = {
  studentNumber: string;
  studentName: string;
  email: string;
  passwordStatus: "temporary" | "personalized";
  temporaryPassword: string | null;
};

export function UsersPage() {
  const { can, user: sessionUser } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [userOpen, setUserOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({ fullName: "", email: "", password: "", roleId: "", studentId: "", isActive: true });
  const [studentOptions, setStudentOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: "", description: "" });
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [viewingCredentials, setViewingCredentials] = useState<User | null>(null);
  const [credentialResult, setCredentialResult] = useState<StudentCredentials | null>(null);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load(searchTerm = search) {
    const query = searchTerm.trim() ? `?search=${encodeURIComponent(searchTerm.trim())}` : "";
    const [userRows, roleRows, students] = await Promise.all([
      api<User[]>(`/users${query}`),
      api<Role[]>("/users/roles/list"),
      api<Array<{ id: number; name: string }>>("/users/student-options")
    ]);
    setUsers(userRows);
    setRoles(roleRows);
    setStudentOptions(students);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { load(search).catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  function createUser() {
    setEditing(null);
    setUserForm({ fullName: "", email: "", password: "", roleId: "", studentId: "", isActive: true });
    setUserOpen(true);
  }

  function editUser(user: User) {
    setEditing(user);
    setUserForm({ fullName: user.full_name, email: user.email, password: "", roleId: String(user.role_id), studentId: user.student_id == null ? "" : String(user.student_id), isActive: Boolean(user.is_active) });
    setUserOpen(true);
  }

  async function saveUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(editing ? `/users/${editing.id}` : "/users", {
        method: editing ? "PATCH" : "POST",
        body: userForm
      });
      toast.success(editing ? "Usuario actualizado." : "Usuario creado.");
      setUserOpen(false);
      load(search);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar.");
    } finally { setBusy(false); }
  }

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/users/roles", { method: "POST", body: roleForm });
      toast.success("Rol creado.");
      setRoleOpen(false);
      load(search);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible crear el rol.");
    } finally { setBusy(false); }
  }

  async function openPermissions(role: Role) {
    const result = await api<{ permissions: any[] }>(`/users/roles/${role.id}`);
    setCurrentRole(role);
    setPermissions(result.permissions);
    setPermissionsOpen(true);
  }

  async function savePermissions() {
    if (!currentRole) return;
    setBusy(true);
    try {
      await api(`/users/roles/${currentRole.id}/permissions`, {
        method: "PUT",
        body: { permissionIds: permissions.filter((permission) => permission.enabled).map((permission) => permission.id) }
      });
      toast.success("Permisos actualizados.");
      setPermissionsOpen(false);
      load(search);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible actualizar.");
    } finally { setBusy(false); }
  }

  async function resetStudentAccess() {
    if (!resetting) return;
    setBusy(true);
    try {
      const result = await api<{ email: string; temporaryPassword: string }>(`/users/${resetting.id}/reset-student-password`, { method: "POST" });
      setResetResult(result);
      toast.success("Contraseña del alumno restablecida.");
      load(search);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible restablecer la contraseña.");
    } finally {
      setBusy(false);
    }
  }

  async function openStudentCredentials(user: User) {
    setViewingCredentials(user);
    setCredentialResult(null);
    setCredentialBusy(true);
    try {
      setCredentialResult(await api<StudentCredentials>(`/users/${user.id}/student-credentials`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible consultar las credenciales.");
      setViewingCredentials(null);
    } finally {
      setCredentialBusy(false);
    }
  }

  async function deleteUserAccess() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/users/${deleting.id}`, { method: "DELETE" });
      toast.success("Cuenta de acceso eliminada.");
      setDeleting(null);
      await load(search);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible eliminar la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  const groupedPermissions = permissions.reduce<Record<string, any[]>>((groups, permission) => {
    (groups[permission.module] ??= []).push(permission);
    return groups;
  }, {});
  const selectedRole = roles.find((role) => String(role.id) === userForm.roleId);

  return (
    <div className="page-stack">
      <div className="page-tabs">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><UsersRound size={18} /> Usuarios</button>
        <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")}><ShieldCheck size={18} /> Roles y permisos</button>
      </div>
      {tab === "users" ? (
        <section className="table-section">
          <header className="section-heading"><div><span>Acceso</span><h2>Cuentas del sistema</h2></div><div className="section-heading-tools"><label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar usuario, correo o rol" /></label><Button icon={<Plus size={18} />} onClick={createUser}>Nuevo usuario</Button></div></header>
          <div className="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Alumno vinculado</th><th>Último acceso</th><th>Estado</th><th aria-label="Acciones" /></tr></thead><tbody>
            {users.map((user) => <tr key={user.id}><td><div className="person-cell"><div className="mini-avatar">{user.full_name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div><div><strong>{user.full_name}</strong><span>{user.email}</span></div></div></td><td><span className="role-chip">{user.role_name}</span></td><td>{user.student_name ? <><strong className="table-main">{user.student_name}</strong><span className="table-sub">{user.student_number}{user.password_must_change ? " · Contraseña temporal" : " · Contraseña personalizada"}</span></> : <span className="muted-cell">No aplica</span>}</td><td>{user.last_login_at ? new Date(user.last_login_at).toLocaleString("es-MX") : "Sin acceso"}</td><td><StatusBadge active={Boolean(user.is_active)} /></td><td><div className="split-actions">{user.student_id && <button title="Ver credenciales del alumno" onClick={() => openStudentCredentials(user)}><Eye size={17} /></button>}{user.student_id && <button title="Restablecer contraseña del alumno" onClick={() => { setResetting(user); setResetResult(null); }}><KeyRound size={17} /></button>}<button title="Editar usuario" onClick={() => editUser(user)}><Pencil size={17} /></button>{user.id !== sessionUser?.id && <button title="Eliminar cuenta de acceso" onClick={() => setDeleting(user)}><Trash2 size={17} /></button>}</div></td></tr>)}
          </tbody></table></div>
        </section>
      ) : (
        <section className="role-grid">
          {roles.map((role) => (
            <article className="role-card" key={role.id}>
              <div className="role-icon"><UserCog size={21} /></div>
              <div><h3>{role.name}</h3><p>{role.description || "Rol personalizado"}</p></div>
              <span>{role.permission_count} permisos</span>
              {can("roles.manage") && <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => openPermissions(role)}>Configurar</Button>}
            </article>
          ))}
          {can("roles.manage") && <button className="add-role" onClick={() => { setRoleForm({ name: "", description: "" }); setRoleOpen(true); }}><Plus size={22} /><strong>Crear rol</strong></button>}
        </section>
      )}

      <Modal open={userOpen} onClose={() => setUserOpen(false)} title={editing ? "Editar usuario" : "Nuevo usuario"}>
        <form onSubmit={saveUser}><div className="form-grid two">
          <Field label="Nombre completo" required hint={editing?.student_id ? "Vinculado automáticamente al expediente." : undefined}><input value={userForm.fullName} onChange={(event) => setUserForm({ ...userForm, fullName: event.target.value })} readOnly={Boolean(editing?.student_id)} required /></Field>
          <Field label="Correo" required hint={editing?.student_id ? "Generado a partir de la matrícula." : undefined}><input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} readOnly={Boolean(editing?.student_id)} required /></Field>
          <Field label={editing ? "Nueva contraseña" : "Contraseña"} required={!editing}><input type="password" minLength={8} value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required={!editing} /></Field>
          <Field label="Rol" required><Select value={userForm.roleId} onChange={(event) => setUserForm({ ...userForm, roleId: event.target.value, studentId: "" })} options={roles} disabled={Boolean(editing?.student_id)} required /></Field>
          {selectedRole?.name === "Alumno" && <Field label="Alumno vinculado" required><Select value={userForm.studentId} onChange={(event) => setUserForm({ ...userForm, studentId: event.target.value })} options={editing?.student_id ? [{ id: editing.student_id, name: `${editing.student_name} · ${editing.student_number}` }] : studentOptions} placeholder="Selecciona una matrícula" disabled={Boolean(editing?.student_id)} required /></Field>}
          {editing && <Field label="Cuenta activa"><label className="toggle-control"><input type="checkbox" checked={userForm.isActive} onChange={(event) => setUserForm({ ...userForm, isActive: event.target.checked })} /><i /><span>{userForm.isActive ? "Activa" : "Inactiva"}</span></label></Field>}
        </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setUserOpen(false)}>Cancelar</Button><Button type="submit" busy={busy}>Guardar</Button></div></form>
      </Modal>

      <Modal open={roleOpen} onClose={() => setRoleOpen(false)} title="Crear rol">
        <form onSubmit={createRole}><div className="form-grid"><Field label="Nombre" required><input value={roleForm.name} onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })} required /></Field><Field label="Descripción"><textarea value={roleForm.description} onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })} /></Field></div><div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setRoleOpen(false)}>Cancelar</Button><Button type="submit" busy={busy}>Crear rol</Button></div></form>
      </Modal>

      <Modal open={Boolean(viewingCredentials)} onClose={() => { setViewingCredentials(null); setCredentialResult(null); }} title="Credenciales del alumno" size="small">
        {credentialBusy || !credentialResult ? <div className="loading-panel">Consultando acceso...</div> : (
          <div className="form-grid">
            <p>Acceso de {credentialResult.studentName} · {credentialResult.studentNumber}</p>
            <Field label="Correo institucional"><input value={credentialResult.email} readOnly /></Field>
            {credentialResult.passwordStatus === "temporary" && credentialResult.temporaryPassword ? (
              <Field label="Contraseña temporal" hint="El alumno todavía debe cambiar esta contraseña."><input value={credentialResult.temporaryPassword} readOnly /></Field>
            ) : (
              <div className="danger-confirmation"><KeyRound size={28} /><div><strong>Contraseña personalizada</strong><p>Por seguridad no es posible recuperar la contraseña que el alumno eligió. Puedes restablecerla si la perdió.</p></div></div>
            )}
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => { setViewingCredentials(null); setCredentialResult(null); }}>Cerrar</Button>
              {credentialResult.passwordStatus === "personalized" && <Button icon={<KeyRound size={17} />} onClick={() => { const user = viewingCredentials; setViewingCredentials(null); setCredentialResult(null); setResetting(user); setResetResult(null); }}>Restablecer</Button>}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(resetting)} onClose={() => { setResetting(null); setResetResult(null); }} title="Restablecer acceso del alumno" size="small">
        {resetResult ? (
          <div className="form-grid">
            <p>Comparte estas credenciales con {resetting?.student_name}. Al iniciar sesión podrá cambiar la contraseña.</p>
            <Field label="Correo institucional"><input value={resetResult.email} readOnly /></Field>
            <Field label="Contraseña temporal"><input value={resetResult.temporaryPassword} readOnly /></Field>
            <div className="modal-actions"><Button onClick={() => { setResetting(null); setResetResult(null); }}>Cerrar</Button></div>
          </div>
        ) : (
          <>
            <div className="danger-confirmation"><KeyRound size={30} /><div><strong>Se generará una contraseña temporal</strong><p>La contraseña de {resetting?.student_name} volverá a ser 1234 + su primer nombre en minúsculas.</p></div></div>
            <div className="modal-actions"><Button variant="ghost" onClick={() => setResetting(null)}>Cancelar</Button><Button icon={<KeyRound size={17} />} busy={busy} onClick={resetStudentAccess}>Restablecer</Button></div>
          </>
        )}
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Eliminar cuenta de acceso" size="small">
        <div className="danger-confirmation"><TriangleAlert size={30} /><div><strong>Se eliminará el acceso de {deleting?.full_name}</strong><p>La persona ya no podrá iniciar sesión. El expediente del alumno, sus pagos, materias, calificaciones y registros institucionales no serán eliminados.</p></div></div>
        <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button><Button type="button" variant="danger" icon={<Trash2 size={17} />} busy={busy} onClick={deleteUserAccess}>Eliminar acceso</Button></div>
      </Modal>

      <Modal open={permissionsOpen} onClose={() => setPermissionsOpen(false)} title={`Permisos · ${currentRole?.name ?? ""}`} size="large">
        <div className="permission-list">
          {Object.entries(groupedPermissions).map(([module, items]) => (
            <section key={module}><h3>{module}</h3>{items.map((permission: any) => <label key={permission.id}><input type="checkbox" checked={Boolean(permission.enabled)} onChange={(event) => setPermissions(permissions.map((item) => item.id === permission.id ? { ...item, enabled: event.target.checked ? 1 : 0 } : item))} /><span><strong>{permission.name}</strong><small>{permission.code}</small></span></label>)}</section>
          ))}
        </div>
        <div className="modal-actions"><Button variant="ghost" onClick={() => setPermissionsOpen(false)}>Cancelar</Button><Button busy={busy} onClick={savePermissions}>Guardar permisos</Button></div>
      </Modal>
    </div>
  );
}
