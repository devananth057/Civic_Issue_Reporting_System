async function loadRoleIssues(token, department_id) {
  const res = await fetch('/api/issues?department_id=' + department_id, { headers: { 'Authorization': 'Bearer ' + token }});
  const j = await res.json();
  return j.issues || [];
}
