// Headless handling benchmark: runs each vehicle on a flat plane and reports
// 0-60 mph, top speed, 60-0 braking distance and steady-state lateral grip.
import * as THREE from 'three';
import { initPhysics, Physics } from '../src/fw/physics.js';
import { Vehicle, HANDLING } from '../src/fw/vehicle.js';
await initPhysics();
for (const type of Object.keys(HANDLING)) {
  const run = (setup) => {
    const physics = new Physics();
    physics.staticBox(0, -0.5, 0, 3000, 0.5, 3000);
    const game = { physics, scene: new THREE.Scene() };
    const v = new Vehicle(game, type, new THREE.Vector3(0, 0, 0), 0);
    v.driver = 'test';
    for (let i = 0; i < 60; i++) physics.update(1 / 60); // settle
    return { physics, v };
  };
  // acceleration + top speed
  let { physics, v } = run();
  v.input.throttle = 1;
  let t = 0, t60 = null, top = 0;
  for (; t < 60; t += 1 / 60) { physics.update(1 / 60); const s = v.speed; top = Math.max(top, s); if (!t60 && s >= 26.82) t60 = t; }
  // braking from 60 mph
  ({ physics, v } = run());
  v.input.throttle = 1;
  while (v.speed < 26.82) physics.update(1 / 60);
  v.input.throttle = 0; v.input.brake = 1;
  const p0 = v.position.clone(); let bt = 0;
  while (v.speed > 0.3 && bt < 10) { physics.update(1 / 60); bt += 1 / 60; }
  const brakeDist = v.position.distanceTo(p0);
  // steady-state cornering at full lock, ~50 km/h target
  ({ physics, v } = run());
  v.input.throttle = 1;
  while (v.speed < 14) physics.update(1 / 60);
  v.input.steer = 1; let maxLat = 0, roll = 0;
  for (let i = 0; i < 300; i++) {
    v.input.throttle = v.speed < 14 ? 0.6 : 0;
    const before = v.velocity; physics.update(1 / 60); const after = v.velocity;
    const acc = after.sub(before).multiplyScalar(60); const lat = Math.abs(acc.dot(v.right));
    if (i > 60) maxLat = Math.max(maxLat, lat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(v.quaternion); roll = Math.max(roll, Math.acos(Math.min(1, up.y)) * 57.3);
  }
  console.log(`${type.padEnd(6)} 0-60mph ${t60 ? t60.toFixed(1) + 's' : '>60s'}  top ${(top * 2.237).toFixed(0)}mph  60-0 ${brakeDist.toFixed(1)}m  lateral ${(maxLat / 9.81).toFixed(2)}g  roll ${roll.toFixed(1)}deg  upright=${new THREE.Vector3(0,1,0).applyQuaternion(v.quaternion).y.toFixed(2)}`);
}
