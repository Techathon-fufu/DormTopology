import { createDemoProject } from '../../src/data/demoProject'
import { deskBeamTopY, DESK_BEAM_Z } from '../../src/scene/sceneValidation'

/** Historical parametric room remains supported alongside the versioned fixed model. */
export function createLegacyDemoProject() {
  const project = createDemoProject()
  project.room = { ...project.room, furnitureModel: undefined,
    desk: { width: 1.6, depth: .8, height: .75, thickness: .025 },
    shelf: { enabled: true, levels: 1, heightAboveDesk: .38, depth: .2 },
    posts: [[-.93, .07], [.93, .07], [-.93, .83], [.93, .83]].map(([x, z], i) => ({ id: ['post-fl', 'post-fr', 'post-bl', 'post-br'][i], position: [x, 0, z], section: .04 })),
    cableHoles: [{ id: 'hole-1', position: [.65, .75, .12], diameter: .05 }],
  }
  project.organization = { ...project.organization!, cupCorner: 'backLeft' }
  project.objects = project.objects.map((object) => object.powerStrip ? { ...object, transform: { position: [-.35, deskBeamTopY(project.room), DESK_BEAM_Z], rotationY: 0 } } : object)
  return project
}
