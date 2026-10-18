import { bookLocalPoint, validBookPose } from '@/scene/bookPose'
export type Vec3 = [number, number, number];
export type PlanStatus = 'success' | 'partial' | 'infeasible';
export type RoutingMode = 'slot' | 'backboard';
export type ReasonCode =
  | 'invalid_input' | 'no_space' | 'collision' | 'item_spacing' | 'incompatible_ports'
  | 'port_occupied' | 'length_exceeded' | 'endpoint_blocked' | 'no_path' | 'unsupported_mode'
  | 'unsupported_span';

export interface Issue {
  entity_id: string | null;
  code: ReasonCode;
  message: string;
}

export interface Port {
  id: string;
  type: 'power_source' | 'power_sink' | 'usb' | 'network' | 'hdmi';
  local_position: Vec3;
  local_direction: Vec3;
  capacity: number;
  confirmed: boolean;
}

export interface Item {
  id: string;
  name: string;
  category: string;
  size_m: Vec3;
  position: Vec3;
  rotation_y_rad: number;
  book_pose?: 'original' | 'upright' | 'flat';
  dimensions_source: 'user' | 'template' | 'estimated';
  dimensions_confirmed: boolean;
  fixed: boolean;
  usage_frequency: 'high' | 'medium' | 'low';
  allowed_region_ids: string[];
  allowed_rotations_y_rad: number[];
  collision: { type: 'box' };
  ports: Port[];
  image_url: string | null;
  model_url: string | null;
  generation: {
    task_id: string | null;
    status: 'not_requested' | 'queued' | 'running' | 'succeeded' | 'failed';
    source: 'placeholder' | 'live' | 'cache';
    error: string | null;
  };
  socket_count?: 4 | 6 | 8;
  placement_priority?: number;
  plug_mount?: { socket_port_id: string; plug_port_id: string };
}

export interface Region {
  id: string;
  surface_y_m: number;
  bounds_xz_m: [number, number, number, number];
  clearance_height_m: number;
}

export interface BoxZone {
  id: string;
  min: Vec3;
  max: Vec3;
}

export interface GraphNode {
  id: string;
  position: Vec3;
  kind: 'corner' | 'slot' | 'fixing_point' | 'endpoint';
}

export interface GraphEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  modes: RoutingMode[];
  clearance_radius_m: number;
  exposed: boolean;
}

export interface RoutingSupport {
  id: string;
  kind: 'surface' | 'cable_tie' | 'cable_tray';
  obstacle_id: string;
  face: 'x_min' | 'x_max' | 'y_min' | 'y_max' | 'z_min' | 'z_max';
  bounds_uv_m: [number, number, number, number];
  stand_off_m: number;
}

export interface TrayCandidate extends Omit<RoutingSupport, 'kind' | 'face'> {
  kind: 'cable_tray';
  face: 'y_min';
  cable_ids: string[];
}

export interface Cable {
  id: string;
  start_port_id: string;
  end_port_id: string;
  cable_type: 'power' | 'usb' | 'network' | 'hdmi';
  thickness: 'thick' | 'thin';
  length_m: number | null;
  diameter_m: number;
  min_bend_radius_m: number;
  slack_m: number;
  mode: RoutingMode;
  baseline_path_points?: Vec3[];
}

export interface Scene {
  schema_version: '1.0';
  scene_id: string;
  scene_revision: number;
  baseline_id: string | null;
  template_id: string;
  desk: { width_m: number; depth_m: number; top_height_m: number };
  wall: { z_m: number; bounds_xy_m: [number, number, number, number] };
  items: Item[];
  regions: Region[];
  obstacles: BoxZone[];
  reserved_zones: BoxZone[];
  exposure_zones: BoxZone[];
  routing_graph: {
    spatial_cost_policy?: import('@/scene/routingPolicy').SpatialCostPolicy;
    path_style?: 'smooth' | 'orthogonal';
    nodes: GraphNode[];
    edges: GraphEdge[];
    support_policy?: { max_unsupported_span_m: number };
    supports?: RoutingSupport[];
    tray_candidates?: TrayCandidate[];
  };
  cables: Cable[];
  constraints?: { min_item_gap_m: number };
}

export interface PackingItem {
  item_id: string;
  name: string;
  model_url: string | null;
  current_pos: Vec3;
  target_pos: Vec3;
  target_rotation_y_rad: number;
  target_book_pose?: 'original' | 'upright' | 'flat';
  target_region_id: string | null;
  placement_status: 'placed' | 'unchanged' | 'unplaced';
  reason_code: ReasonCode | null;
}

export interface PackingResult {
  schema_version: '1.0';
  scene_id: string;
  scene_revision: number;
  status: PlanStatus;
  items: PackingItem[];
  issues: Issue[];
}

export interface CableRoute {
  id: string;
  start_port_id: string;
  end_port_id: string;
  cable_type: Cable['cable_type'];
  thickness: Cable['thickness'];
  mode: RoutingMode;
  diameter_m: number;
  status: 'valid' | 'failed';
  curve_segments: { control_points: [Vec3, Vec3, Vec3, Vec3] }[];
  path_points: Vec3[];
  path_length_m: number | null;
  reason_code: ReasonCode | null;
  support_check?: {
    status: 'verified' | 'not_evaluated';
    max_unsupported_span_m: number | null;
    support_ids: string[];
  };
}

export interface UndersideTrayOptimization {
  id: string;
  status: 'recommended' | 'verified' | 'not_used';
  support_id: string | null;
  cable_ids: string[];
  shared_length_m: number;
  occupied_width_m: number;
  available_width_m: number | null;
  requires_installation: boolean;
  reason_code: 'no_compatible_routes' | 'insufficient_width' | 'not_evaluated' | null;
  mount: {
    obstacle_id: string;
    face: RoutingSupport['face'];
    bounds_uv_m: [number, number, number, number];
    stand_off_m: number;
  };
}

export interface RoutingResult {
  schema_version: '1.0';
  scene_id: string;
  scene_revision: number;
  status: PlanStatus;
  cables: CableRoute[];
  underside_tray_optimizations?: UndersideTrayOptimization[];
  metrics: { exposed_length_m: number | null; baseline_exposed_length_m: number | null };
  issues: Issue[];
}

/** Result validation uses source identities and ports, independently of collision representation. */
export type RoutingResultScene = Omit<Scene, 'items'> & {
  items: Array<Pick<Item, 'id' | 'position' | 'rotation_y_rad' | 'dimensions_confirmed' | 'book_pose' | 'size_m'> & { ports: Array<Pick<Port, 'id' | 'local_position' | 'confirmed'>> }>;
};

export interface Bundle {
  scene: Scene;
  packingResult?: PackingResult;
  routingScene?: Scene;
  routingResult?: RoutingResult;
}

export interface FixtureCase {
  id: string;
  label: string;
  kind: 'packing' | 'routing';
  description: string;
  scene_url: string;
  packing_result_url?: string;
  applied_scene_url?: string;
  routing_result_url?: string;
  expected: { packing_status?: PlanStatus; routing_status?: PlanStatus; reason_codes: ReasonCode[] };
  metrics?: { before_free_area_m2: number; after_free_area_m2: number };
}

export interface Manifest {
  schema_version: '1.0';
  generated_by: string;
  cases: FixtureCase[];
}

// Viewer budgets bound GPU resources and synchronous import work, not domain planning.
export const VISUALIZATION_LIMITS = {
  coordinate_m: 1_000_000,
  items: 256,
  ports: 512,
  regions: 128,
  zones: 256,
  graph_nodes: 512,
  graph_edges: 1024,
  supports: 256,
  tray_optimizations: 512,
  cables: 256,
  path_points: 200_000,
  curve_segments: 20_000,
  issues: 2048,
  fixture_cases: 64,
} as const;

type JsonObject = Record<string, unknown>;
const REASONS = ['invalid_input', 'no_space', 'collision', 'item_spacing', 'incompatible_ports', 'port_occupied',
  'length_exceeded', 'endpoint_blocked', 'no_path', 'unsupported_mode', 'unsupported_span'] as const;
const STATUSES = ['success', 'partial', 'infeasible'] as const;
const MODES = ['slot', 'backboard'] as const;
const EPSILON = 1e-6;

function invalid(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected an object');
  return value as JsonObject;
}

function array(value: unknown, path: string, maximum: number = VISUALIZATION_LIMITS.path_points): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'expected an array');
  if (value.length > maximum) invalid(path, `viewer limit is ${maximum} entries`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(path, 'expected a non-empty string');
  return value;
}

function nullableString(value: unknown, path: string): void {
  if (value !== null) string(value, path);
}

function number(value: unknown, path: string, minimum = -Infinity, exclusive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || (exclusive ? value <= minimum : value < minimum)) invalid(path, 'expected a finite number in range');
  return value;
}

function geometryNumber(value: unknown, path: string, minimum = -Infinity, exclusive = false): number {
  const coordinate = number(value, path, minimum, exclusive);
  if (Math.abs(coordinate) > VISUALIZATION_LIMITS.coordinate_m) invalid(path, 'geometry exceeds the viewer coordinate limit');
  return coordinate;
}

function integer(value: unknown, path: string, minimum = 1): void {
  if (!Number.isSafeInteger(number(value, path, minimum))) invalid(path, 'expected an integer');
}

function boolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') invalid(path, 'expected a boolean');
}

function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid(path, `expected ${choices.join(' / ')}`);
  return value as T;
}

function vector(value: unknown, path: string, positive = false): Vec3 {
  const values = array(value, path);
  if (values.length !== 3) invalid(path, 'expected three coordinates');
  values.forEach((coordinate, index) => geometryNumber(coordinate, `${path}[${index}]`, positive ? 0 : -Infinity, positive));
  return values as Vec3;
}

function bounds(value: unknown, path: string): void {
  const values = array(value, path);
  if (values.length !== 4) invalid(path, 'expected four bounds');
  values.forEach((coordinate, index) => geometryNumber(coordinate, `${path}[${index}]`));
  if ((values[0] as number) >= (values[1] as number) || (values[2] as number) >= (values[3] as number)) {
    invalid(path, 'minimum bounds must be smaller than maximum bounds');
  }
}

function sameVector(left: Vec3, right: Vec3): boolean {
  return left.every((coordinate, index) => Math.abs(coordinate - right[index]) <= EPSILON);
}

function requireSameVector(left: Vec3, right: Vec3, path: string): void {
  if (!sameVector(left, right)) invalid(path, 'does not match the source scene');
}

function header(value: JsonObject, path: string): void {
  choice(value.schema_version, ['1.0'], `${path}.schema_version`);
  string(value.scene_id, `${path}.scene_id`);
  integer(value.scene_revision, `${path}.scene_revision`);
}

function matchRevision(value: JsonObject, scene: RoutingResultScene, path: string): void {
  header(value, path);
  if (value.scene_id !== scene.scene_id || value.scene_revision !== scene.scene_revision) {
    invalid(path, `scene_id and scene_revision must match ${scene.scene_id} @ ${scene.scene_revision}`);
  }
  if (scene.baseline_id === null) invalid(path, 'a confirmed baseline is required for planning results');
  if (scene.items.some((item) => !item.dimensions_confirmed)) invalid(path, 'source dimensions are not confirmed');
}

function validateIssues(value: unknown, ids: Set<string>, path: string): void {
  array(value, path, VISUALIZATION_LIMITS.issues).forEach((entry, index) => {
    const issuePath = `${path}[${index}]`;
    const issue = object(entry, issuePath);
    nullableString(issue.entity_id, `${issuePath}.entity_id`);
    if (issue.entity_id !== null && !ids.has(issue.entity_id as string)) invalid(issuePath, 'unknown entity_id');
    choice(issue.code, REASONS, `${issuePath}.code`);
    string(issue.message, `${issuePath}.message`);
  });
}

function sceneIds(scene: RoutingResultScene): Set<string> {
  return new Set([
    ...scene.items.flatMap((item) => [item.id, ...item.ports.map((port) => port.id)]),
    ...[scene.regions, scene.obstacles, scene.reserved_zones, scene.exposure_zones,
      scene.routing_graph.nodes, scene.routing_graph.edges, scene.routing_graph.supports ?? [],
      scene.routing_graph.tray_candidates ?? [], scene.cables].flatMap((entries) => entries.map((entry) => entry.id)),
  ]);
}

function parseScene(value: unknown, path: string): Scene {
  const scene = object(value, path);
  header(scene, path);
  nullableString(scene.baseline_id, `${path}.baseline_id`);
  string(scene.template_id, `${path}.template_id`);
  if (scene.constraints !== undefined) {
    const constraints = object(scene.constraints, `${path}.constraints`);
    number(constraints.min_item_gap_m, `${path}.constraints.min_item_gap_m`, 0);
  }
  const desk = object(scene.desk, `${path}.desk`);
  ['width_m', 'depth_m', 'top_height_m'].forEach((key) => geometryNumber(desk[key], `${path}.desk.${key}`, 0, true));
  const wall = object(scene.wall, `${path}.wall`);
  geometryNumber(wall.z_m, `${path}.wall.z_m`);
  bounds(wall.bounds_xy_m, `${path}.wall.bounds_xy_m`);
  const ids = new Set<string>();
  const claim = (value: unknown, entryPath: string) => {
    const id = string(value, entryPath);
    if (ids.has(id)) invalid(entryPath, 'duplicate scene entity ID');
    ids.add(id);
    return id;
  };
  const regionIds = new Set<string>();
  array(scene.regions, `${path}.regions`, VISUALIZATION_LIMITS.regions).forEach((entry, index) => {
    const entryPath = `${path}.regions[${index}]`;
    const region = object(entry, entryPath);
    regionIds.add(claim(region.id, `${entryPath}.id`));
    geometryNumber(region.surface_y_m, `${entryPath}.surface_y_m`);
    bounds(region.bounds_xz_m, `${entryPath}.bounds_xz_m`);
    geometryNumber(region.clearance_height_m, `${entryPath}.clearance_height_m`, 0, true);
  });
  for (const key of ['obstacles', 'reserved_zones', 'exposure_zones']) {
    array(scene[key], `${path}.${key}`, VISUALIZATION_LIMITS.zones).forEach((entry, index) => {
      const entryPath = `${path}.${key}[${index}]`;
      const zone = object(entry, entryPath);
      claim(zone.id, `${entryPath}.id`);
      const min = vector(zone.min, `${entryPath}.min`);
      const max = vector(zone.max, `${entryPath}.max`);
      if (min.some((coordinate, axis) => coordinate >= max[axis])) invalid(entryPath, 'min must be smaller than max');
    });
  }
  const ports = new Map<string, Port>();
  array(scene.items, `${path}.items`, VISUALIZATION_LIMITS.items).forEach((entry, index) => {
    const entryPath = `${path}.items[${index}]`;
    const item = object(entry, entryPath);
    claim(item.id, `${entryPath}.id`);
    string(item.name, `${entryPath}.name`);
    string(item.category, `${entryPath}.category`);
    vector(item.size_m, `${entryPath}.size_m`, true);
    vector(item.position, `${entryPath}.position`);
    number(item.rotation_y_rad, `${entryPath}.rotation_y_rad`);
    if (item.book_pose !== undefined && (!validBookPose(item.book_pose) || !['book', 'books'].includes(String(item.category)))) invalid(entryPath, 'invalid book posture');
    choice(item.dimensions_source, ['user', 'template', 'estimated'], `${entryPath}.dimensions_source`);
    boolean(item.dimensions_confirmed, `${entryPath}.dimensions_confirmed`);
    boolean(item.fixed, `${entryPath}.fixed`);
    if (item.placement_priority !== undefined) {
      integer(item.placement_priority, `${entryPath}.placement_priority`, 0);
      if ((item.placement_priority as number) > 100) invalid(`${entryPath}.placement_priority`, 'priority must not exceed 100');
    }
    choice(item.usage_frequency, ['high', 'medium', 'low'], `${entryPath}.usage_frequency`);
    const regions = array(item.allowed_region_ids, `${entryPath}.allowed_region_ids`, VISUALIZATION_LIMITS.regions);
    if (!item.fixed && regions.length === 0) invalid(entryPath, 'movable items require an allowed region');
    const uniqueRegions = new Set<string>();
    regions.forEach((id, regionIndex) => {
      const regionId = string(id, `${entryPath}.allowed_region_ids[${regionIndex}]`);
      if (!regionIds.has(regionId) || uniqueRegions.has(regionId)) invalid(entryPath, 'unknown or duplicate allowed region');
      uniqueRegions.add(regionId);
    });
    const rotations = array(item.allowed_rotations_y_rad, `${entryPath}.allowed_rotations_y_rad`, 8);
    if (!rotations.length) invalid(entryPath, 'allowed rotations cannot be empty');
    if (new Set(rotations).size !== rotations.length) invalid(entryPath, 'allowed rotations must be unique');
    rotations.forEach((rotation, rotationIndex) => {
      const angle = number(rotation, `${entryPath}.allowed_rotations_y_rad[${rotationIndex}]`);
      if (angle < -Math.PI || angle > Math.PI) invalid(entryPath, 'automatic rotations must be within [-pi, pi]');
    });
    const collision = object(item.collision, `${entryPath}.collision`);
    choice(collision.type, ['box'], `${entryPath}.collision.type`);
    array(item.ports, `${entryPath}.ports`, VISUALIZATION_LIMITS.ports).forEach((portEntry, portIndex) => {
      const portPath = `${entryPath}.ports[${portIndex}]`;
      const port = object(portEntry, portPath);
      const portId = claim(port.id, `${portPath}.id`);
      choice(port.type, ['power_source', 'power_sink', 'usb', 'network', 'hdmi'], `${portPath}.type`);
      vector(port.local_position, `${portPath}.local_position`);
      const direction = vector(port.local_direction, `${portPath}.local_direction`);
      if (Math.abs(Math.hypot(...direction) - 1) > 0.001) invalid(portPath, 'local_direction must be a unit vector');
      integer(port.capacity, `${portPath}.capacity`);
      if (port.capacity !== 1) invalid(portPath, 'v1 port capacity must be 1');
      boolean(port.confirmed, `${portPath}.confirmed`);
      ports.set(portId, port as unknown as Port);
      if (ports.size > VISUALIZATION_LIMITS.ports) invalid(path, `viewer limit is ${VISUALIZATION_LIMITS.ports} ports`);
    });
    nullableString(item.image_url, `${entryPath}.image_url`);
    nullableString(item.model_url, `${entryPath}.model_url`);
    const generation = object(item.generation, `${entryPath}.generation`);
    nullableString(generation.task_id, `${entryPath}.generation.task_id`);
    choice(generation.status, ['not_requested', 'queued', 'running', 'succeeded', 'failed'], `${entryPath}.generation.status`);
    choice(generation.source, ['placeholder', 'live', 'cache'], `${entryPath}.generation.source`);
    nullableString(generation.error, `${entryPath}.generation.error`);
    if (item.category === 'power_strip') {
      if (![4, 6, 8].includes(item.socket_count as number)) invalid(entryPath, 'power strip socket_count must be 4, 6 or 8');
      const itemPorts = item.ports as Port[];
      if (itemPorts.filter((port) => port.type === 'power_source').length !== item.socket_count
        || itemPorts.filter((port) => port.type === 'power_sink').length !== 1) invalid(entryPath, 'power strip ports do not match socket_count');
    }
  });
  const items = scene.items as unknown as Item[];
  const portOwners = new Map(items.flatMap((item) => item.ports.map((port) => [port.id, item] as const)));
  const mountedPorts = new Set<string>();
  items.forEach((item, index) => {
    if (item.plug_mount === undefined) return;
    const mountPath = `${path}.items[${index}].plug_mount`;
    const mount = object(item.plug_mount, mountPath);
    if (item.category !== 'power_adapter' || !item.fixed) invalid(mountPath, 'plug mounts require a fixed power_adapter');
    const socketId = string(mount.socket_port_id, `${mountPath}.socket_port_id`);
    const plugId = string(mount.plug_port_id, `${mountPath}.plug_port_id`);
    const socket = ports.get(socketId);
    const plug = ports.get(plugId);
    const strip = portOwners.get(socketId);
    if (!socket || strip?.category !== 'power_strip' || !strip.fixed || socket.type !== 'power_source') {
      invalid(`${mountPath}.socket_port_id`, 'socket must belong to a fixed power_strip power_source');
    }
    if (!plug || portOwners.get(plugId)?.id !== item.id || plug.type !== 'power_sink') {
      invalid(`${mountPath}.plug_port_id`, 'plug must belong to this power_adapter power_sink');
    }
    if (!item.dimensions_confirmed || !strip!.dimensions_confirmed || !socket!.confirmed || !plug!.confirmed) {
      invalid(mountPath, 'plug mount dimensions and ports must be confirmed');
    }
    for (const portId of [socketId, plugId]) {
      if (mountedPorts.has(portId)) invalid(mountPath, 'port already used by another plug mount');
      mountedPorts.add(portId);
    }
  });
  const graph = object(scene.routing_graph, `${path}.routing_graph`);
  if (graph.path_style !== undefined) choice(graph.path_style, ['smooth', 'orthogonal'], `${path}.routing_graph.path_style`);
  if (graph.spatial_cost_policy !== undefined) {
    const p = `${path}.routing_graph.spatial_cost_policy`;
    const policy = object(graph.spatial_cost_policy, p);
    if (graph.path_style !== 'orthogonal') invalid(p, 'spatial cost requires orthogonal routing');
    for (const key of ['desktop_min', 'desktop_max', 'corner_start', 'corner_end', 'seat_position']) vector(policy[key], `${p}.${key}`);
    const min = policy.desktop_min as Vec3, max = policy.desktop_max as Vec3;
    if (min.some((v, i) => v >= max[i])) invalid(p, 'desktop bounds must be strictly increasing');
    const start = policy.corner_start as Vec3, end = policy.corner_end as Vec3;
    if (Math.hypot(...start.map((v, i) => v - end[i])) <= 1e-9) invalid(p, 'corner segment must have nonzero length');
    geometryNumber(policy.distance_scale_m, `${p}.distance_scale_m`, 0, true);
    for (const key of ['corner_weight', 'seat_weight']) geometryNumber(policy[key], `${p}.${key}`, 0);
  }
  const nodeIds = new Set<string>();
  array(graph.nodes, `${path}.routing_graph.nodes`, VISUALIZATION_LIMITS.graph_nodes).forEach((entry, index) => {
    const entryPath = `${path}.routing_graph.nodes[${index}]`;
    const node = object(entry, entryPath);
    nodeIds.add(claim(node.id, `${entryPath}.id`));
    vector(node.position, `${entryPath}.position`);
    choice(node.kind, ['corner', 'slot', 'fixing_point', 'endpoint'], `${entryPath}.kind`);
  });
  array(graph.edges, `${path}.routing_graph.edges`, VISUALIZATION_LIMITS.graph_edges).forEach((entry, index) => {
    const entryPath = `${path}.routing_graph.edges[${index}]`;
    const edge = object(entry, entryPath);
    claim(edge.id, `${entryPath}.id`);
    if (!nodeIds.has(string(edge.from_node_id, `${entryPath}.from_node_id`))
      || !nodeIds.has(string(edge.to_node_id, `${entryPath}.to_node_id`))) invalid(entryPath, 'edge references unknown graph nodes');
    const modes = array(edge.modes, `${entryPath}.modes`, MODES.length);
    if (!modes.length || new Set(modes).size !== modes.length) invalid(entryPath, 'modes must be a non-empty unique subset');
    modes.forEach((mode) => choice(mode, MODES, `${entryPath}.modes`));
    geometryNumber(edge.clearance_radius_m, `${entryPath}.clearance_radius_m`, 0, true);
    boolean(edge.exposed, `${entryPath}.exposed`);
  });
  if (graph.support_policy !== undefined) {
    const policyPath = `${path}.routing_graph.support_policy`;
    const policy = object(graph.support_policy, policyPath);
    geometryNumber(policy.max_unsupported_span_m, `${policyPath}.max_unsupported_span_m`, 0, true);
  }
  if (graph.supports !== undefined) {
    if (graph.support_policy === undefined) invalid(`${path}.routing_graph.supports`, 'supports require a support_policy');
    const obstacles = new Map((scene.obstacles as BoxZone[]).map((obstacle) => [obstacle.id, obstacle]));
    array(graph.supports, `${path}.routing_graph.supports`, VISUALIZATION_LIMITS.supports).forEach((entry, index) => {
      const entryPath = `${path}.routing_graph.supports[${index}]`;
      const support = object(entry, entryPath);
      claim(support.id, `${entryPath}.id`);
      const kind = choice(support.kind, ['surface', 'cable_tie', 'cable_tray'], `${entryPath}.kind`);
      const obstacle = obstacles.get(string(support.obstacle_id, `${entryPath}.obstacle_id`));
      if (!obstacle) invalid(`${entryPath}.obstacle_id`, 'support references an unknown obstacle');
      const face = choice(support.face, ['x_min', 'x_max', 'y_min', 'y_max', 'z_min', 'z_max'], `${entryPath}.face`);
      bounds(support.bounds_uv_m, `${entryPath}.bounds_uv_m`);
      const patch = support.bounds_uv_m as number[];
      const faceAxis = { x: 0, y: 1, z: 2 }[face[0] as 'x' | 'y' | 'z'];
      const axes = [0, 1, 2].filter((axis) => axis !== faceAxis);
      if (axes.some((axis, index) => patch[index * 2] < obstacle.min[axis]
        || patch[index * 2 + 1] > obstacle.max[axis])) invalid(`${entryPath}.bounds_uv_m`, 'support patch must lie within its obstacle face');
      const standOff = geometryNumber(support.stand_off_m, `${entryPath}.stand_off_m`, 0, true);
      const maximum = kind === 'surface' ? 0.02 : kind === 'cable_tie' ? 0.05 : 0.10;
      if (standOff > maximum) invalid(`${entryPath}.stand_off_m`, `support stand-off exceeds ${maximum} m`);
      if (kind === 'surface' && face !== 'y_max') invalid(`${entryPath}.face`, 'passive surfaces only support a top face');
      if (kind === 'cable_tie' && (patch[1] - patch[0] > 0.05 + 1e-10
        || patch[3] - patch[2] > 0.05 + 1e-10)) invalid(`${entryPath}.bounds_uv_m`, 'cable tie patch extents must not exceed 0.05 m');
    });
  }
  let baselinePoints = 0;
  array(scene.cables, `${path}.cables`, VISUALIZATION_LIMITS.cables).forEach((entry, index) => {
    const entryPath = `${path}.cables[${index}]`;
    const cable = object(entry, entryPath);
    claim(cable.id, `${entryPath}.id`);
    if (!ports.has(string(cable.start_port_id, `${entryPath}.start_port_id`))
      || !ports.has(string(cable.end_port_id, `${entryPath}.end_port_id`))) invalid(entryPath, 'cable references unknown ports');
    if (cable.start_port_id === cable.end_port_id) invalid(entryPath, 'cable endpoints must differ');
    choice(cable.cable_type, ['power', 'usb', 'network', 'hdmi'], `${entryPath}.cable_type`);
    choice(cable.thickness, ['thick', 'thin'], `${entryPath}.thickness`);
    choice(cable.mode, MODES, `${entryPath}.mode`);
    if (cable.length_m !== null) number(cable.length_m, `${entryPath}.length_m`, 0, true);
    number(cable.diameter_m, `${entryPath}.diameter_m`, 0, true);
    number(cable.min_bend_radius_m, `${entryPath}.min_bend_radius_m`, 0);
    number(cable.slack_m, `${entryPath}.slack_m`, 0);
    if (cable.baseline_path_points !== undefined) {
      const points = array(cable.baseline_path_points, `${entryPath}.baseline_path_points`);
      baselinePoints += points.length;
      if (baselinePoints > VISUALIZATION_LIMITS.path_points) invalid(path, 'baseline paths exceed the viewer sample limit');
      if (points.length < 2) invalid(entryPath, 'baseline path needs at least two points');
      points.forEach((point, pointIndex) => vector(point, `${entryPath}.baseline_path_points[${pointIndex}]`));
    }
  });
  if (graph.tray_candidates !== undefined) {
    const obstacles = new Map((scene.obstacles as BoxZone[]).map((obstacle) => [obstacle.id, obstacle]));
    const cableIds = new Set((scene.cables as Cable[]).map((cable) => cable.id));
    array(graph.tray_candidates, `${path}.routing_graph.tray_candidates`, VISUALIZATION_LIMITS.supports).forEach((entry, index) => {
      const entryPath = `${path}.routing_graph.tray_candidates[${index}]`;
      const candidate = object(entry, entryPath);
      claim(candidate.id, `${entryPath}.id`);
      choice(candidate.kind, ['cable_tray'], `${entryPath}.kind`);
      choice(candidate.face, ['y_min'], `${entryPath}.face`);
      const obstacle = obstacles.get(string(candidate.obstacle_id, `${entryPath}.obstacle_id`));
      if (!obstacle) invalid(`${entryPath}.obstacle_id`, 'candidate references an unknown obstacle');
      bounds(candidate.bounds_uv_m, `${entryPath}.bounds_uv_m`);
      const patch = candidate.bounds_uv_m as number[];
      if ([0, 2].some((axis, axisIndex) => patch[axisIndex * 2] < obstacle.min[axis]
        || patch[axisIndex * 2 + 1] > obstacle.max[axis])) invalid(`${entryPath}.bounds_uv_m`, 'candidate patch must lie within its obstacle underside');
      const standOff = geometryNumber(candidate.stand_off_m, `${entryPath}.stand_off_m`, 0, true);
      if (standOff > 0.10) invalid(`${entryPath}.stand_off_m`, 'candidate stand-off exceeds 0.1 m');
      const members = array(candidate.cable_ids, `${entryPath}.cable_ids`, VISUALIZATION_LIMITS.cables);
      if (members.length < 2) invalid(`${entryPath}.cable_ids`, 'tray candidates require at least two cables');
      const uniqueMembers = new Set<string>();
      members.forEach((member, memberIndex) => {
        const cableId = string(member, `${entryPath}.cable_ids[${memberIndex}]`);
        if (!cableIds.has(cableId) || uniqueMembers.has(cableId)) invalid(`${entryPath}.cable_ids`, 'unknown or duplicate cable ID');
        uniqueMembers.add(cableId);
      });
    });
  }
  return scene as unknown as Scene;
}

function parsePacking(value: unknown, scene: Scene): PackingResult {
  const result = object(value, 'packing_result');
  matchRevision(result, scene, 'packing_result');
  const status = choice(result.status, STATUSES, 'packing_result.status');
  const items = new Map(scene.items.map((item) => [item.id, item]));
  const regions = new Set(scene.regions.map((region) => region.id));
  const seen = new Set<string>();
  let unplaced = 0;
  array(result.items, 'packing_result.items', VISUALIZATION_LIMITS.items).forEach((entry, index) => {
    const path = `packing_result.items[${index}]`;
    const item = object(entry, path);
    const id = string(item.item_id, `${path}.item_id`);
    const original = items.get(id);
    if (!original || seen.has(id)) invalid(path, 'unknown or duplicate item_id');
    seen.add(id);
    if (string(item.name, `${path}.name`) !== original.name || item.model_url !== original.model_url) invalid(path, 'name/model_url must copy the source item');
    const current = vector(item.current_pos, `${path}.current_pos`);
    const target = vector(item.target_pos, `${path}.target_pos`);
    requireSameVector(current, original.position, `${path}.current_pos`);
    const rotation = number(item.target_rotation_y_rad, `${path}.target_rotation_y_rad`);
    if (item.target_book_pose !== undefined && (!validBookPose(item.target_book_pose) || !['book', 'books'].includes(original.category))) invalid(path, 'invalid book posture');
    const placement = choice(item.placement_status, ['placed', 'unchanged', 'unplaced'], `${path}.placement_status`);
    nullableString(item.target_region_id, `${path}.target_region_id`);
    if (item.target_region_id !== null && !regions.has(item.target_region_id as string)) invalid(path, 'unknown target_region_id');
    if (item.reason_code !== null) choice(item.reason_code, REASONS, `${path}.reason_code`);
    if (placement === 'unplaced') {
      unplaced += 1;
      if (item.reason_code === null) invalid(path, 'unplaced items require a reason_code');
    }
    if (status === 'infeasible' || original.fixed || placement !== 'placed') {
      requireSameVector(target, original.position, `${path}.target_pos`);
      if ((item.target_book_pose ?? original.book_pose ?? 'original') !== (original.book_pose ?? 'original')) invalid(path, 'retained book posture must be preserved');
      if (Math.abs(rotation - original.rotation_y_rad) > EPSILON) invalid(path, 'fixed, retained and infeasible poses must be preserved');
    }
    if (original.fixed && placement !== 'unchanged') invalid(path, 'fixed items must be unchanged');
    if (placement === 'placed') {
      if (item.reason_code !== null) invalid(path, 'placed items cannot have a reason_code');
      if (!original.allowed_region_ids.includes(item.target_region_id as string)) invalid(path, 'placed item target region is not allowed');
      if (!original.allowed_rotations_y_rad.some((allowed) => Math.abs(rotation - allowed) <= EPSILON)) invalid(path, 'placed item rotation is not allowed');
    }
  });
  if (seen.size !== items.size) invalid('packing_result.items', 'must cover every source item');
  if ((status === 'success' && unplaced > 0) || (status === 'partial' && unplaced === 0)) invalid('packing_result.status', 'inconsistent with item placement statuses');
  validateIssues(result.issues, sceneIds(scene), 'packing_result.issues');
  return result as unknown as PackingResult;
}

function worldPortPositions(scene: RoutingResultScene): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
  scene.items.forEach((item) => item.ports.forEach((port) => {
    const [x, y, z] = bookLocalPoint(item.size_m, item.book_pose, port.local_position);
    const cosine = Math.cos(item.rotation_y_rad);
    const sine = Math.sin(item.rotation_y_rad);
    positions.set(port.id, [item.position[0] + cosine * x + sine * z,
      item.position[1] + y, item.position[2] - sine * x + cosine * z]);
  }));
  return positions;
}

export function parseRouting(value: unknown, scene: RoutingResultScene): RoutingResult {
  const result = object(value, 'cable_routing');
  matchRevision(result, scene, 'cable_routing');
  const status = choice(result.status, STATUSES, 'cable_routing.status');
  const cables = new Map(scene.cables.map((cable) => [cable.id, cable]));
  const positions = worldPortPositions(scene);
  const ports = new Map(scene.items.flatMap((item) => item.ports.map((port) => [port.id, port] as const)));
  const seen = new Set<string>();
  let valid = 0;
  let pathPointCount = 0;
  let curveSegmentCount = 0;
  array(result.cables, 'cable_routing.cables', VISUALIZATION_LIMITS.cables).forEach((entry, index) => {
    const path = `cable_routing.cables[${index}]`;
    const route = object(entry, path);
    const id = string(route.id, `${path}.id`);
    const source = cables.get(id);
    if (!source || seen.has(id)) invalid(path, 'unknown or duplicate cable ID');
    seen.add(id);
    for (const key of ['start_port_id', 'end_port_id', 'cable_type', 'thickness', 'mode', 'diameter_m'] as const) {
      if (route[key] !== source[key]) invalid(`${path}.${key}`, 'does not match the source cable');
    }
    if (!ports.get(source.start_port_id)?.confirmed || !ports.get(source.end_port_id)?.confirmed) invalid(path, 'source ports are not confirmed');
    const routeStatus = choice(route.status, ['valid', 'failed'], `${path}.status`);
    if (route.support_check !== undefined) {
      const checkPath = `${path}.support_check`;
      const check = object(route.support_check, checkPath);
      const checkStatus = choice(check.status, ['verified', 'not_evaluated'], `${checkPath}.status`);
      const supportIds = array(check.support_ids, `${checkPath}.support_ids`, VISUALIZATION_LIMITS.supports);
      const knownIds = new Set((scene.routing_graph.supports ?? []).map((support) => support.id));
      const uniqueIds = new Set<string>();
      supportIds.forEach((entry, supportIndex) => {
        const supportId = string(entry, `${checkPath}.support_ids[${supportIndex}]`);
        if (!knownIds.has(supportId) || uniqueIds.has(supportId)) invalid(`${checkPath}.support_ids`, 'unknown or duplicate support ID');
        uniqueIds.add(supportId);
      });
      if (checkStatus === 'not_evaluated') {
        if (check.max_unsupported_span_m !== null || supportIds.length) invalid(checkPath, 'unevaluated support checks require null span and no support IDs');
      } else {
        const policy = scene.routing_graph.support_policy;
        if (routeStatus !== 'valid' || !policy) invalid(checkPath, 'verified support requires a valid route and support_policy');
        const span = number(check.max_unsupported_span_m, `${checkPath}.max_unsupported_span_m`, 0);
        if (span > policy.max_unsupported_span_m) invalid(checkPath, 'verified unsupported span exceeds the support policy');
      }
    }
    const pathPoints = array(route.path_points, `${path}.path_points`);
    pathPointCount += pathPoints.length;
    if (pathPointCount > VISUALIZATION_LIMITS.path_points) invalid(path, 'routes exceed the viewer sample limit');
    const points = pathPoints.map((point, pointIndex) => vector(point, `${path}.path_points[${pointIndex}]`));
    const curveSegments = array(route.curve_segments, `${path}.curve_segments`, VISUALIZATION_LIMITS.curve_segments);
    curveSegmentCount += curveSegments.length;
    if (curveSegmentCount > VISUALIZATION_LIMITS.curve_segments) invalid(path, 'routes exceed the viewer curve limit');
    const segments = curveSegments.map((entry, segmentIndex) => {
      const segmentPath = `${path}.curve_segments[${segmentIndex}]`;
      const segment = object(entry, segmentPath);
      const controls = array(segment.control_points, `${segmentPath}.control_points`);
      if (controls.length !== 4) invalid(segmentPath, 'cubic Bezier requires exactly four control points');
      return controls.map((point, pointIndex) => vector(point, `${segmentPath}.control_points[${pointIndex}]`));
    });
    if (routeStatus === 'failed') {
      choice(route.reason_code, REASONS, `${path}.reason_code`);
      if (points.length || segments.length || route.path_length_m !== null) invalid(path, 'failed routes must have empty geometry and null length');
      return;
    }
    valid += 1;
    if (points.length < 2 || segments.length === 0) invalid(path, 'valid routes need at least two samples and one curve segment');
    if (route.reason_code !== null) invalid(path, 'valid routes cannot have a reason_code');
    const length = number(route.path_length_m, `${path}.path_length_m`, 0, true);
    if (source.length_m !== null && length + source.slack_m > source.length_m + EPSILON) invalid(path, 'valid route exceeds the source cable length');
    const start = positions.get(source.start_port_id)!;
    const end = positions.get(source.end_port_id)!;
    requireSameVector(points[0], start, `${path}.path_points[0]`);
    requireSameVector(points[points.length - 1], end, `${path}.path_points[last]`);
    requireSameVector(segments[0][0], start, `${path}.curve_segments[first]`);
    requireSameVector(segments[segments.length - 1][3], end, `${path}.curve_segments[last]`);
    segments.slice(1).forEach((segment, segmentIndex) => {
      requireSameVector(segment[0], segments[segmentIndex][3], `${path}.curve_segments[${segmentIndex + 1}]`);
    });
  });
  if (result.underside_tray_optimizations !== undefined) {
    const optimizationPath = 'cable_routing.underside_tray_optimizations';
    const supports = new Map((scene.routing_graph.supports ?? []).map((support) => [support.id, support]));
    const obstacles = new Map(scene.obstacles.map((obstacle) => [obstacle.id, obstacle]));
    const routes = new Map((result.cables as CableRoute[]).map((route) => [route.id, route]));
    const optimizationIds = new Set<string>();
    array(result.underside_tray_optimizations, optimizationPath, VISUALIZATION_LIMITS.tray_optimizations).forEach((entry, index) => {
      const path = `${optimizationPath}[${index}]`;
      const optimization = object(entry, path);
      const optimizationId = string(optimization.id, `${path}.id`);
      if (optimizationIds.has(optimizationId)) invalid(`${path}.id`, 'duplicate optimization ID');
      optimizationIds.add(optimizationId);
      const optimizationStatus = choice(optimization.status, ['recommended', 'verified', 'not_used'], `${path}.status`);
      if (optimization.support_id !== null) {
        const supportId = string(optimization.support_id, `${path}.support_id`);
        const support = supports.get(supportId);
        if (!support) invalid(`${path}.support_id`, 'unknown support ID');
        if (support?.kind !== 'cable_tray' || support.face !== 'y_min') {
          invalid(`${path}.support_id`, 'tray optimization requires an installed underside cable_tray support');
        }
      }
      const cableIds = array(optimization.cable_ids, `${path}.cable_ids`, VISUALIZATION_LIMITS.cables);
      const uniqueCableIds = new Set<string>();
      cableIds.forEach((entryId, cableIndex) => {
        const cableId = string(entryId, `${path}.cable_ids[${cableIndex}]`);
        if (!cables.has(cableId) || uniqueCableIds.has(cableId)) invalid(`${path}.cable_ids`, 'unknown or duplicate cable ID');
        if (routes.get(cableId)?.status !== 'valid') invalid(`${path}.cable_ids`, 'tray optimization members must have valid routes');
        uniqueCableIds.add(cableId);
      });
      const sharedLength = number(optimization.shared_length_m, `${path}.shared_length_m`, 0);
      const occupiedWidth = number(optimization.occupied_width_m, `${path}.occupied_width_m`, 0);
      const availableWidth = optimization.available_width_m === null ? null
        : number(optimization.available_width_m, `${path}.available_width_m`, 0, true);
      boolean(optimization.requires_installation, `${path}.requires_installation`);
      if (optimization.reason_code !== null) {
        choice(optimization.reason_code, ['no_compatible_routes', 'insufficient_width', 'not_evaluated'], `${path}.reason_code`);
      }
      {
        const mountPath = `${path}.mount`;
        const mount = object(optimization.mount, mountPath);
        const obstacle = obstacles.get(string(mount.obstacle_id, `${mountPath}.obstacle_id`));
        if (!obstacle) invalid(`${mountPath}.obstacle_id`, 'mount references an unknown obstacle');
        const face = choice(mount.face, ['y_min'], `${mountPath}.face`);
        bounds(mount.bounds_uv_m, `${mountPath}.bounds_uv_m`);
        const patch = mount.bounds_uv_m as number[];
        const faceAxis = { x: 0, y: 1, z: 2 }[face[0] as 'x' | 'y' | 'z'];
        const axes = [0, 1, 2].filter((axis) => axis !== faceAxis);
        if (obstacle && axes.some((axis, axisIndex) => patch[axisIndex * 2] < obstacle.min[axis]
          || patch[axisIndex * 2 + 1] > obstacle.max[axis])) invalid(`${mountPath}.bounds_uv_m`, 'mount patch must lie within its obstacle face');
        const standOff = geometryNumber(mount.stand_off_m, `${mountPath}.stand_off_m`, 0, true);
        if (standOff > 0.10) invalid(`${mountPath}.stand_off_m`, 'tray mount stand-off exceeds 0.1 m');
      }
      if (optimizationStatus !== 'not_used') {
        if (cableIds.length < 2 || sharedLength <= 0 || occupiedWidth <= 0) invalid(path, 'active tray groups require two valid routes and positive shared length and width');
        if (availableWidth === null || occupiedWidth > availableWidth) invalid(path, 'active tray group exceeds available width');
        if (optimization.reason_code !== null) invalid(path, 'active tray groups cannot have a reason_code');
      }
      if (optimizationStatus === 'verified') {
        if (optimization.support_id === null || optimization.requires_installation) invalid(path, 'verified trays must reference an installed support');
        const mount = optimization.mount as UndersideTrayOptimization['mount'];
        const support = supports.get(optimization.support_id as string)!;
        if (mount && (mount.obstacle_id !== support.obstacle_id || mount.face !== support.face
          || mount.stand_off_m !== support.stand_off_m
          || mount.bounds_uv_m.some((value, index) => value !== support.bounds_uv_m[index]))) {
          invalid(path, 'verified tray mount must match its installed support');
        }
        if (cableIds.some((cableId) => {
          const check = routes.get(cableId as string)?.support_check;
          return check?.status !== 'verified' || !check.support_ids.includes(optimization.support_id as string);
        })) invalid(path, 'verified tray members require matching support verification');
      } else if (optimizationStatus === 'recommended') {
        if (optimization.support_id !== null || !optimization.requires_installation) {
          invalid(path, 'recommended trays require a candidate mount and installation');
        }
        const mount = optimization.mount as UndersideTrayOptimization['mount'];
        const candidate = scene.routing_graph.tray_candidates?.find((candidate) => mount
          && candidate.obstacle_id === mount.obstacle_id && candidate.face === mount.face
          && candidate.stand_off_m === mount.stand_off_m
          && candidate.bounds_uv_m.every((value, index) => value === mount.bounds_uv_m[index])
          && cableIds.every((cableId) => candidate.cable_ids.includes(cableId as string)));
        if (!candidate) invalid(path, 'recommended tray mount and members must match a source candidate');
      }
    });
  }
  if (seen.size !== cables.size) invalid('cable_routing.cables', 'must cover every source cable');
  const expectedStatus = valid === cables.size ? 'success' : valid > 0 ? 'partial' : 'infeasible';
  if (status !== expectedStatus) invalid('cable_routing.status', 'inconsistent with cable statuses');
  const metrics = object(result.metrics, 'cable_routing.metrics');
  for (const key of ['exposed_length_m', 'baseline_exposed_length_m']) {
    if (metrics[key] !== null) number(metrics[key], `cable_routing.metrics.${key}`, 0);
  }
  if (cables.size > 0 && valid === 0 && metrics.exposed_length_m !== null) invalid('cable_routing.metrics', 'no valid routes means exposed length is unknown');
  if (valid > 0 && metrics.exposed_length_m === null) invalid('cable_routing.metrics', 'valid routes require a current exposed length');
  if (scene.cables.some((cable) => !cable.baseline_path_points) && metrics.baseline_exposed_length_m !== null) invalid('cable_routing.metrics', 'missing baseline paths must remain unknown');
  validateIssues(result.issues, sceneIds(scene), 'cable_routing.issues');
  return result as unknown as RoutingResult;
}

function equalData(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  let inspected = 0;
  while (pending.length) {
    if (++inspected > 1_000_000) return false;
    const [first, second] = pending.pop()!;
    if (first === second) continue;
    if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false;
    if (Array.isArray(first) !== Array.isArray(second)) return false;
    const keys = Object.keys(first);
    if (keys.length !== Object.keys(second).length) return false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(second, key)) return false;
      pending.push([(first as JsonObject)[key], (second as JsonObject)[key]]);
    }
  }
  return true;
}

export function parseBundle(scene: unknown, packing?: unknown, routing?: unknown, routingScene?: unknown): Bundle {
  const bundle: Bundle = { scene: parseScene(scene, 'scene') };
  if (packing !== undefined) bundle.packingResult = parsePacking(packing, bundle.scene);
  if (routingScene !== undefined) {
    bundle.routingScene = parseScene(routingScene, 'applied_scene');
    if (bundle.routingScene.scene_id !== bundle.scene.scene_id) invalid('applied_scene', 'scene_id must match scene');
    if (bundle.routingScene.baseline_id !== bundle.scene.baseline_id) invalid('applied_scene', 'baseline_id must match scene');
    const packingResult = bundle.packingResult;
    if (!packingResult || packingResult.status === 'infeasible') invalid('applied_scene', 'requires an applicable packing_result');
    if (bundle.routingScene.scene_revision !== bundle.scene.scene_revision + 1) invalid('applied_scene', 'applied revision must be source revision + 1');
    const targets = new Map(packingResult.items.map((item) => [item.item_id, item]));
    if (bundle.routingScene.items.length !== targets.size) invalid('applied_scene.items', 'must preserve all source items');
    bundle.routingScene.items.forEach((item) => {
      const target = targets.get(item.id);
      if (!target) invalid('applied_scene.items', 'unknown item ID');
      requireSameVector(item.position, target.target_pos, `applied_scene.items.${item.id}.position`);
      if (Math.abs(item.rotation_y_rad - target.target_rotation_y_rad) > EPSILON) invalid('applied_scene.items', 'rotation does not match packing target');
    });
    const expected = { ...bundle.scene, scene_revision: bundle.routingScene.scene_revision,
      items: bundle.scene.items.map((item) => ({ ...item, position: targets.get(item.id)!.target_pos,
        rotation_y_rad: targets.get(item.id)!.target_rotation_y_rad,
        ...(targets.get(item.id)!.target_book_pose !== undefined ? { book_pose: targets.get(item.id)!.target_book_pose } : {}) })),
    };
    if (!equalData(expected, bundle.routingScene)) {
      invalid('applied_scene', 'applying a layout may only change item positions, rotations and scene_revision');
    }
  }
  if (routing !== undefined) bundle.routingResult = parseRouting(routing, bundle.routingScene ?? bundle.scene);
  return bundle;
}

function fixtureUrl(value: unknown, path: string): void {
  const url = string(value, path);
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url) || url.includes('\\')) invalid(path, 'fixture URL must be a local path');
}

export function parseManifest(value: unknown): Manifest {
  const manifest = object(value, 'manifest');
  choice(manifest.schema_version, ['1.0'], 'manifest.schema_version');
  string(manifest.generated_by, 'manifest.generated_by');
  const ids = new Set<string>();
  const cases = array(manifest.cases, 'manifest.cases', VISUALIZATION_LIMITS.fixture_cases);
  if (cases.length === 0) invalid('manifest.cases', 'at least one fixture is required');
  cases.forEach((entry, index) => {
    const path = `manifest.cases[${index}]`;
    const fixture = object(entry, path);
    const id = string(fixture.id, `${path}.id`);
    if (ids.has(id)) invalid(path, 'duplicate case ID');
    ids.add(id);
    string(fixture.label, `${path}.label`);
    const kind = choice(fixture.kind, ['packing', 'routing'], `${path}.kind`);
    string(fixture.description, `${path}.description`);
    fixtureUrl(fixture.scene_url, `${path}.scene_url`);
    for (const key of ['packing_result_url', 'applied_scene_url', 'routing_result_url']) {
      if (fixture[key] !== undefined) fixtureUrl(fixture[key], `${path}.${key}`);
    }
    if (kind === 'packing' && fixture.packing_result_url === undefined) invalid(path, 'packing case requires packing_result_url');
    if (kind === 'routing' && fixture.routing_result_url === undefined) invalid(path, 'routing case requires routing_result_url');
    if (fixture.applied_scene_url !== undefined && fixture.packing_result_url === undefined) invalid(path, 'applied scene requires packing result');
    const expected = object(fixture.expected, `${path}.expected`);
    for (const key of ['packing_status', 'routing_status']) {
      if (expected[key] !== undefined) choice(expected[key], STATUSES, `${path}.expected.${key}`);
    }
    array(expected.reason_codes, `${path}.expected.reason_codes`, REASONS.length).forEach((reason) => choice(reason, REASONS, `${path}.expected.reason_codes`));
    if (fixture.metrics !== undefined) {
      const metrics = object(fixture.metrics, `${path}.metrics`);
      number(metrics.before_free_area_m2, `${path}.metrics.before_free_area_m2`, 0);
      number(metrics.after_free_area_m2, `${path}.metrics.after_free_area_m2`, 0);
    }
  });
  return manifest as unknown as Manifest;
}
