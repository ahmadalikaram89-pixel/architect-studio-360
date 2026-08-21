// حساب دور المستخدم الحالي بمشروع معيّن (مالك / محرّر / مُشاهد / بلا وصول) اعتماداً على
// projects.user_id وقائمة project_members المحمّلة أصلاً مع المشروع — بلا أي استعلام إضافي
export function computeMembership(project, members, userId) {
  if (!project || !userId) return { role: null, isOwner: false, canEdit: false };
  if (project.user_id === userId) return { role: "owner", isOwner: true, canEdit: true };
  const membership = (members || []).find((m) => m.user_id === userId);
  const role = membership ? membership.role : null;
  return { role, isOwner: false, canEdit: role === "editor" };
}
