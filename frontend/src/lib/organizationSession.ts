import type { Project } from '@/types/project'

/** Geometry and planning input fingerprint; selection and camera do not affect it. */
export function organizationSource(project: Project): string {
  return JSON.stringify([project.id, project.room, project.objects, project.cables, project.organization])
}

export function canApplyOrganization(source: string | null, project: Project): boolean {
  return source !== null && source === organizationSource(project)
}
