import * as THREE from "three";

/**
 * First person walk mode.
 *
 * The player walks with WASD, looks with the mouse (pointer lock) and jumps
 * with space. Collision is done with raycasts against the real triangles of
 * every object flagged as solid, so a doorway or window carved out of a wall
 * is actually walkable / jumpable through, while the wall itself blocks.
 * Steps and stairs up to STEP_HEIGHT are climbed automatically.
 */

const EYE = 1.62;
const RADIUS = 0.32;
const STEP_HEIGHT = 0.55;
const GRAVITY = 20;
const WALK_SPEED = 4.2;
const RUN_SPEED = 8;
const JUMP_SPEED = 7.4;

export class WalkController {
  public camera = new THREE.PerspectiveCamera(72, 1, 0.05, 2000);
  public enabled = false;
  public grounded = false;

  private dom: HTMLElement;
  private getSolids: () => THREE.Object3D[];
  private onExit: () => void;

  /** feet position */
  private pos = new THREE.Vector3(0, 0, 6);
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private ray = new THREE.Raycaster();

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouse: (e: MouseEvent) => void;
  private boundLock: () => void;

  constructor(dom: HTMLElement, getSolids: () => THREE.Object3D[], onExit: () => void) {
    this.dom = dom;
    this.getSolids = getSolids;
    this.onExit = onExit;

    this.boundKeyDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    };
    this.boundKeyUp = (e) => this.keys.delete(e.code);
    this.boundMouse = (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0024;
      this.pitch -= e.movementY * 0.0024;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    };
    this.boundLock = () => {
      if (this.enabled && document.pointerLockElement !== this.dom) this.onExit();
    };

    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
    window.addEventListener("mousemove", this.boundMouse);
    document.addEventListener("pointerlockchange", this.boundLock);
  }

  public setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  public enter(from: THREE.Vector3, lookAt: THREE.Vector3) {
    this.enabled = true;
    this.keys.clear();
    this.vel.set(0, 0, 0);
    this.pos.set(from.x, Math.max(from.y - EYE, 0), from.z);
    const dir = lookAt.clone().sub(from);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = 0;
    this.syncCamera();
    void this.dom.requestPointerLock?.();
  }

  public exit() {
    this.enabled = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  public dispose() {
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    window.removeEventListener("mousemove", this.boundMouse);
    document.removeEventListener("pointerlockchange", this.boundLock);
  }

  /* ------------------------------------------------ physics */

  private blocked(dir: THREE.Vector3, dist: number, solids: THREE.Object3D[]) {
    if (!solids.length) return false;
    const heights = [STEP_HEIGHT + 0.1, EYE * 0.6, EYE - 0.05];
    for (const h of heights) {
      const origin = this.pos.clone().setY(this.pos.y + h);
      this.ray.set(origin, dir);
      this.ray.far = dist + RADIUS;
      const hits = this.ray.intersectObjects(solids, false);
      if (hits.length) return true;
    }
    return false;
  }

  private groundAt(solids: THREE.Object3D[], probe: number) {
    if (!solids.length) return null;
    const origin = this.pos.clone().setY(this.pos.y + STEP_HEIGHT);
    this.ray.set(origin, new THREE.Vector3(0, -1, 0));
    this.ray.far = STEP_HEIGHT + probe;
    const hits = this.ray.intersectObjects(solids, false);
    if (!hits.length) return null;
    return hits[0]!.point.y;
  }

  public update(rawDelta: number) {
    if (!this.enabled) return;
    const dt = Math.min(rawDelta, 0.05);
    const solids = this.getSolids();

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    let fw = 0;
    let sd = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fw += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fw -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) sd += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) sd -= 1;

    const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? RUN_SPEED : WALK_SPEED;
    const wish = new THREE.Vector3()
      .addScaledVector(forward, fw)
      .addScaledVector(right, sd);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed * dt);

    // horizontal movement, axis by axis so we slide along walls
    for (const axis of ["x", "z"] as const) {
      const step = wish[axis];
      if (Math.abs(step) < 1e-6) continue;
      const dir = new THREE.Vector3();
      dir[axis] = Math.sign(step);
      if (!this.blocked(dir, Math.abs(step), solids)) this.pos[axis] += step;
    }

    // jump + gravity
    if (this.keys.has("Space") && this.grounded) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;

    // head bump
    if (this.vel.y > 0) {
      const origin = this.pos.clone().setY(this.pos.y + EYE - 0.05);
      this.ray.set(origin, new THREE.Vector3(0, 1, 0));
      this.ray.far = 0.25;
      if (this.ray.intersectObjects(solids, false).length) this.vel.y = 0;
    }

    const probe = Math.max(0.2, -this.vel.y * dt + 0.1);
    const groundY = this.groundAt(solids, probe);
    const floor = groundY !== null ? Math.max(groundY, 0) : 0;
    if (this.pos.y <= floor + 0.001) {
      this.pos.y = floor;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.vel.y <= 0 && groundY !== null && this.pos.y < groundY) {
      this.pos.y = groundY;
      this.vel.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (this.pos.y < -20) {
      this.pos.set(0, 2, 6);
      this.vel.set(0, 0, 0);
    }

    this.syncCamera();
  }

  private syncCamera() {
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }
}
