import { createStandardRoom } from '@/data/demoProject'
import { uid } from '@/lib/utils'
import type { Project } from '@/types/project'

const CREATION_DRAFT_KEY = 'dormtopology.project-creation-draft'
export function projectCreationPath(project: Project): string {
  return project.stage === 'space'
    ? `/projects/${project.id}/setup`
    : `/projects/${project.id}/import`
}

function readDraftId(): string | null {
  try {
    return window.sessionStorage.getItem(CREATION_DRAFT_KEY)
  } catch {
    return null
  }
}

function rememberDraft(id: string): void {
  try {
    window.sessionStorage.setItem(CREATION_DRAFT_KEY, id)
  } catch {
    // The persisted project remains resumable even when sessionStorage is unavailable.
  }
}

export function beginProjectCreation(
  projects: Record<string, Project>,
  draftIds: Record<string, true>,
): { project: Project; created: boolean } {
  const remembered = readDraftId()
  const rememberedProject = remembered ? projects[remembered] : undefined
  if (rememberedProject && draftIds[rememberedProject.id]) {
    return { project: rememberedProject, created: false }
  }

  const resumable = Object.values(projects)
    .filter((project) => draftIds[project.id])
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (resumable) {
    rememberDraft(resumable.id)
    return { project: resumable, created: false }
  }

  const now = Date.now()
  const id = uid('proj')
  const project: Project = {
    id,
    name: '我的宿舍书桌',
    isDemo: false,
    source: 'user',
    createdAt: now,
    updatedAt: now,
    room: createStandardRoom(),
    objects: [],
    cables: [],
    stage: 'space',
  }
  rememberDraft(id)
  return { project, created: true }
}

export function completeProjectCreation(projectId: string): void {
  try {
    if (window.sessionStorage.getItem(CREATION_DRAFT_KEY) === projectId) {
      window.sessionStorage.removeItem(CREATION_DRAFT_KEY)
    }
  } catch {
    // Completion is represented by the persisted project stage; this pointer is only a shortcut.
  }
}
