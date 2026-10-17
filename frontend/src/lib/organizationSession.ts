import type { Project } from '@/types/project'

/** Geometry and planning input fingerprint; selection and camera do not affect it. */
export function organizationSource(project: Project): string {
  const cables = project.cables.map(({ status: _status, updatedAt: _updatedAt, route, ...cable }) => {
    const { verification: _verification, pathLengthM: _pathLengthM, ...geometry } = route
    return { ...cable, route: geometry }
  })
  return JSON.stringify([project.id, project.room, project.objects, cables, project.organization])
}

export function canApplyOrganization(source: string | null, project: Project): boolean {
  return source !== null && source === organizationSource(project)
}
