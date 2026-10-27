import {
  ACESFilmicToneMapping, HalfFloatType, ShaderMaterial, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Quality } from './quality';

export type GradePreset = 'broadcast' | 'cinematic' | 'natural';

const GRADES: Record<GradePreset, { contrast: number; saturation: number; lift: [number, number, number]; gain: [number, number, number]; vignette: number }> = {
  broadcast: { contrast: 1.08, saturation: 1.12, lift: [0.0, 0.004, 0.008], gain: [1.03, 1.0, 0.97], vignette: 0.28 },
  cinematic: { contrast: 1.16, saturation: 0.9, lift: [0.01, 0.012, 0.02], gain: [1.06, 0.99, 0.9], vignette: 0.42 },
  natural: { contrast: 1.0, saturation: 1.0, lift: [0, 0, 0], gain: [1, 1, 1], vignette: 0.12 },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uContrast: { value: 1.08 }, uSaturation: { value: 1.1 }, uLift: { value: [0, 0, 0] }, uGain: { value: [1, 1, 1] },
    uVignette: { value: 0.28 }, uGrain: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uFade: { value: 0 }, uLetterbox: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast, uSaturation, uVignette, uGrain, uTime, uAspect, uFade, uLetterbox; uniform vec3 uLift, uGain;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uGain + uLift;
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = 1.0 - smoothstep(0.35, 0.95, length(d)) * uVignette * 1.6;
      col *= v;
      col += (h(vUv * 800.0) - 0.5) * uGrain;
      col *= 1.0 - uFade;
      float lb = step(uLetterbox, vUv.y) * step(vUv.y, 1.0 - uLetterbox);
      col *= lb;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class PostStack {
  composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private after: AfterimagePass | null = null;
  private fxaa: ShaderPass | null = null;
  private gradeName: GradePreset = 'broadcast';
  fade = 0;
  letterbox = 0;
  private q: Quality | null = null;
  private size = new Vector2(1, 1);

  constructor(private renderer: WebGLRenderer, private scene: Scene, private camera: PerspectiveCamera) {}

  needsComposer(q: Quality): boolean {
    return q.bloom || q.antialias === 'smaa' || q.antialias === 'fxaa' || q.vignette || q.filmGrain || q.motionBlur;
  }

  apply(q: Quality, grade: GradePreset): void {
    this.q = q; this.gradeName = grade;
    this.dispose();
    if (!this.needsComposer(q)) {
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      return;
    }
    this.renderer.toneMapping = ACESFilmicToneMapping; // applied once by the OutputPass
    this.renderer.toneMappingExposure = 1.0;
    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.16, 0.4, 1.9);
      composer.addPass(this.bloom);
    }
    if (q.motionBlur) { this.after = new AfterimagePass(0.55); composer.addPass(this.after); }
    this.grade = new ShaderPass(new ShaderMaterial(GradeShader));
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    if (q.antialias === 'smaa') composer.addPass(new SMAAPass());
    else if (q.antialias === 'fxaa') { this.fxaa = new ShaderPass(FXAAShader); composer.addPass(this.fxaa); }
    this.composer = composer;
    this.setGrade(grade);
    this.resize(this.size.x, this.size.y);
  }

  setGrade(g: GradePreset): void {
    this.gradeName = g;
    if (!this.grade) return;
    const p = GRADES[g];
    const u = this.grade.uniforms as Record<string, { value: unknown }>;
    u.uContrast!.value = p.contrast; u.uSaturation!.value = p.saturation; u.uLift!.value = p.lift; u.uGain!.value = p.gain;
    u.uVignette!.value = this.q?.vignette ? p.vignette : 0;
    u.uGrain!.value = this.q?.filmGrain ? 0.035 : 0;
  }

  resize(w: number, h: number): void {
    this.size.set(w, h);
    if (!this.composer) return;
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    if (this.fxaa) (this.fxaa.uniforms as Record<string, { value: Vector2 }>).resolution!.value.set(1 / (w * pr), 1 / (h * pr));
    if (this.grade) (this.grade.uniforms as Record<string, { value: number }>).uAspect!.value = w / h;
  }

  render(dt: number, time: number): void {
    if (this.composer) {
      if (this.grade) {
        const u = this.grade.uniforms as Record<string, { value: number }>;
        u.uTime!.value = time % 10; u.uFade!.value = this.fade; u.uLetterbox!.value = this.letterbox;
      }
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  setCamera(c: PerspectiveCamera): void { this.camera = c; }

  dispose(): void {
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    this.bloom = null; this.grade = null; this.after = null; this.fxaa = null;
  }
}
