import { useEffect, useRef } from "react";
import * as THREE from "three";

interface LiquidSurfaceProps {
  className?: string;
  intensity?: number;
  speed?: number;
}

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x),
      f.y
    );
  }

  float fluidField(vec2 p, float t) {
    float largeFlow = noise(p * 2.1 + vec2(t * 0.12, -t * 0.08));
    float crossFlow = noise(p * 4.3 + vec2(-t * 0.09, t * 0.13));
    float fineFlow = sin((p.x + p.y) * 12.0 + t * 0.85) * 0.5 + 0.5;
    return largeFlow * 0.58 + crossFlow * 0.3 + fineFlow * 0.12;
  }

  void main() {
    vec2 uv = vUv;
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec2 p = (uv - 0.5) * aspect;
    float t = uTime;

    float fluid = fluidField(p, t);
    float nextX = fluidField(p + vec2(0.018, 0.0), t);
    float nextY = fluidField(p + vec2(0.0, 0.018), t);
    vec2 normal = normalize(vec2(fluid - nextX, fluid - nextY) + 0.001);

    vec2 pointerPosition = (uPointer - 0.5) * aspect;
    float pointerDistance = length(p - pointerPosition);
    float ripple = sin(pointerDistance * 34.0 - t * 4.5) * exp(-pointerDistance * 8.0);
    ripple *= step(pointerDistance, 0.52);

    float specular = pow(max(dot(normalize(vec3(normal, 0.72)), normalize(vec3(-0.42, 0.56, 0.86))), 0.0), 9.0);
    float movingHighlight = smoothstep(0.72, 0.97, fluid + ripple * 0.12);
    float edge = smoothstep(0.0, 0.1, uv.x) * smoothstep(0.0, 0.1, uv.y)
      * smoothstep(0.0, 0.1, 1.0 - uv.x) * smoothstep(0.0, 0.1, 1.0 - uv.y);
    float rim = 1.0 - edge;

    vec3 base = vec3(0.035, 0.028, 0.072);
    vec3 violet = vec3(0.33, 0.25, 0.68);
    vec3 pearl = vec3(0.88, 0.84, 1.0);
    vec3 color = mix(base, violet, fluid * 0.36 * uIntensity);
    color += pearl * (specular * 0.24 + movingHighlight * 0.055 + rim * 0.1);
    color += vec3(0.2, 0.52, 0.44) * max(ripple, 0.0) * 0.035;

    float alpha = (0.32 + fluid * 0.12 + specular * 0.13 + rim * 0.08) * uIntensity;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.72));
  }
`;

export function LiquidSurface({ className = "", intensity = 1, speed = 1 }: LiquidSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.25 : 1.6));
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPointer: { value: new THREE.Vector2(0.72, 0.25) },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const pointerTarget = new THREE.Vector2(0.72, 0.25);
    const handlePointer = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      pointerTarget.set(
        THREE.MathUtils.clamp((event.clientX - bounds.left) / Math.max(bounds.width, 1), 0, 1),
        THREE.MathUtils.clamp(1 - (event.clientY - bounds.top) / Math.max(bounds.height, 1), 0, 1),
      );
    };

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    window.addEventListener("pointermove", handlePointer, { passive: true });
    resize();

    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      frame = window.requestAnimationFrame(render);
      if (!reduceMotion) uniforms.uTime.value += Math.min(clock.getDelta(), 0.05) * speed;
      uniforms.uPointer.value.lerp(pointerTarget, reduceMotion ? 1 : 0.055);
      renderer.render(scene, camera);
    };
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", handlePointer);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [intensity, speed]);

  return <div ref={hostRef} className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden="true" />;
}
