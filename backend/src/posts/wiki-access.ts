export type WikiAccessContext = {
    role: string;
    department: string | null | undefined;
};

export function canAccessWiki(actor: WikiAccessContext, documentDepartment: string): boolean {
    if (actor.role === 'admin') {
        return true;
    }

    return documentDepartment === '공통' || documentDepartment === actor.department;
}
