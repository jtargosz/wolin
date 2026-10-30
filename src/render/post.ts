// Post-processing: ambient occlusion in the nooks, a miniature depth of field (sharp at the
// camera target, soft toward the frame edges), a gentle bloom on fire and glints, a warm
// grade and a vignette. One scene pass with MSAA and an extra normal target feeds it all.

import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { dot, float, length, mix, mrt, normalView, output, pass, screenUV, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { QualityProfile } from './quality.ts';

export class Post {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly focus = uniform(60);
  private readonly focal = uniform(34);

  /** The profile switches the expensive parts off: AO (and its normal target), DoF, bloom. High keeps all. */
  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, profile: QualityProfile) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    // no MSAA here: GTAO needs a single-sampled depth; SMAA smooths the edges at the end
    const scenePass = pass(scene, camera);
    // pass targets are half float, so the view normal is stored signed, unpacked
    if (profile.ao > 0) scenePass.setMRT(mrt({ output, normal: normalView }));
    const color = scenePass.getTextureNode('output');

    let lit = color.rgb as unknown as Node<'vec3'>;
    if (profile.ao > 0) {
      const normal = scenePass.getTextureNode('normal');
      const depth = scenePass.getTextureNode('depth');
      const aoPass = ao(depth, normal, camera);
      aoPass.resolutionScale = profile.ao;
      aoPass.radius.value = 1.6;
      aoPass.thickness.value = 1.2;
      aoPass.scale.value = 1.15;
      const occlusion = aoPass.getTextureNode().r;
      // soft contact shadows: never fully black, the sky light still reaches in
      lit = color.rgb.mul(mix(float(1), occlusion, 0.85)) as unknown as Node<'vec3'>;
    }

    const focused = (
      profile.dof ? dof(vec4(lit, 1), scenePass.getViewZNode(), this.focus, this.focal, 1.4) : vec4(lit, 1)
    ) as unknown as Node<'vec4'>;
    let c = focused.rgb as unknown as Node<'vec3'>;
    if (profile.bloom) c = c.add(bloom(focused, 0.28, 0.35, 0.92).rgb) as unknown as Node<'vec3'>;
    // grade: a touch more saturation, warm highlights
    const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, 1.1).mul(vec3(1.035, 1.0, 0.95));
    const vig = smoothstep(0.38, 0.95, length(screenUV.sub(0.5)).mul(1.3));
    c = c.mul(float(1).sub(vig.mul(0.4)));
    this.pipeline.outputNode = smaa(vec4(c, 1));
  }

  /** Keeps the focal plane on the camera target. */
  setFocus(distance: number): void {
    this.focus.value = distance;
    this.focal.value = distance * 0.55;
  }

  render(): void {
    this.pipeline.render();
  }
}
