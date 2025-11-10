// app/components/CircleWallpaper.tsx
"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";

const GRID_ROTATION_RAD = THREE.MathUtils.degToRad(20);
const GRID_COS = Math.cos(GRID_ROTATION_RAD);
const GRID_SIN = Math.sin(GRID_ROTATION_RAD);
const BASE_X_SPACING_MULTIPLIER = 1 / 0.82;
const BASE_Y_SPACING_MULTIPLIER = 1.29;
const Y_SPACING_REDUCTION = 0.9;
const Y_SPACING_MULTIPLIER = BASE_Y_SPACING_MULTIPLIER * Y_SPACING_REDUCTION;
const X_SPACING_MULTIPLIER = ((BASE_X_SPACING_MULTIPLIER * Y_SPACING_REDUCTION) + Y_SPACING_MULTIPLIER) / 2 * 1.08;
const MIN_OPACITY = 0.08;
const HALF_OPACITY = 0.5;
const FALLOFF_POWER = 3.2;
const HORIZONTAL_SCROLL_SPEED = 2.0;
const CAMERA_FOV = 40;
const CAMERA_DISTANCE = 45;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 200;
const GRID_PLANE_Z = 0;

type BaseInstanceData = {
  baseX: number;
  baseY: number;
  row: number;
  col: number;
  shift: number;
  worldColumn: number;
  baseOpacity: number;
};

type LayoutState = {
  hasData: boolean;
  xSpacing: number;
  ySpacing: number;
  diameter: number;
  baseZ: number;
  scaleX: number;
  scaleY: number;
  amplitude: number;
  secondaryAmplitude: number;
  rippleAmplitude: number;
  waveLength: number;
};

type WaveParams = {
  speed: number;
  secondaryFrequency: number;
  rippleFrequencyX: number;
  rippleFrequencyZ: number;
  rippleSpeed: number;
  pulseSpeed: number;
  pulseSpatialX: number;
  pulseSpatialZ: number;
};

export type CircleWallpaperProps = {
  style?: CSSProperties;
};

export function CircleWallpaper({ style }: CircleWallpaperProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseInstancesRef = useRef<BaseInstanceData[]>([]);
  const baseOpacityRef = useRef<Float32Array>(new Float32Array(0));
  const layoutStateRef = useRef<LayoutState>({
    hasData: false,
    xSpacing: 1,
    ySpacing: 1,
    diameter: 1,
    baseZ: GRID_PLANE_Z,
    scaleX: 1,
    scaleY: 1,
    amplitude: 1,
    secondaryAmplitude: 0.15,
    rippleAmplitude: 0.05,
    waveLength: 4,
  });
  const waveParamsRef = useRef<WaveParams>({
    speed: 1.2,
    secondaryFrequency: 1.5,
    rippleFrequencyX: 2.5,
    rippleFrequencyZ: 1.8,
    rippleSpeed: 3.0,
    pulseSpeed: 1.5,
    pulseSpatialX: 0.8,
    pulseSpatialZ: 0.6,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const baseSeed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 0x9e3779b1;

    const scene = new THREE.Scene();
    const scrollGroup = new THREE.Group();
    const circlesGroup = new THREE.Group();
    circlesGroup.rotation.z = GRID_ROTATION_RAD;
    scrollGroup.add(circlesGroup);
    scene.add(scrollGroup);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xffffff, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.pointerEvents = "none";
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      container.clientWidth / container.clientHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, GRID_PLANE_Z);

    const circleGeometry = new THREE.PlaneGeometry(1, 1);
    const circleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    circleMaterial.side = THREE.DoubleSide;
    circleMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;',
        )
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvInstanceOpacity = instanceOpacity;");

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vInstanceOpacity;")
        .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n\tgl_FragColor.a *= vInstanceOpacity;");
    };
    circleMaterial.customProgramCacheKey = () => "circle-opacity";
    circleMaterial.needsUpdate = true;

    let instancedCircles: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
    let instanceOpacityAttribute: THREE.InstancedBufferAttribute | null = null;
    let instanceCapacity = 0;
    const randomForCell = (row: number, col: number, variant = 0) => {
      let seed =
        ((row * 73856093) ^ (col * 19349663) ^ (variant * 83492791) ^ baseSeed) >>> 0;
      seed = (seed ^ (seed << 13)) >>> 0;
      seed = (seed ^ (seed >>> 17)) >>> 0;
      seed = (seed ^ (seed << 5)) >>> 0;
      return seed / 4294967296;
    };

    const ensureInstanceCapacity = (required: number) => {
      if (required <= 0) {
        if (instancedCircles) {
          instancedCircles.count = 0;
        }
        return;
      }

      if (!instancedCircles || required > instanceCapacity) {
        const nextCapacity = Math.max(required, Math.ceil(Math.max(1, instanceCapacity) * 1.2));
        if (instancedCircles) {
          circlesGroup.remove(instancedCircles);
          instancedCircles.dispose();
        }
        instancedCircles = new THREE.InstancedMesh(circleGeometry, circleMaterial, nextCapacity);
        instancedCircles.frustumCulled = false;
        instancedCircles.renderOrder = 2;
        circlesGroup.add(instancedCircles);
        instanceCapacity = nextCapacity;
        instanceOpacityAttribute = new THREE.InstancedBufferAttribute(new Float32Array(nextCapacity), 1);
        instanceOpacityAttribute.setUsage(THREE.DynamicDrawUsage);
        instancedCircles.geometry.setAttribute("instanceOpacity", instanceOpacityAttribute);
      }

      if (instancedCircles) {
        instancedCircles.count = required;
      }
    };

    const tempPosition = new THREE.Vector3();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();
    const tempMatrix = new THREE.Matrix4();

    let currentWidth = container.clientWidth;
    let currentHeight = container.clientHeight;
    let currentViewWidth = 0;
    let currentViewHeight = 0;
    let scrollOffset = 0;
    let worldColumnOffset = 0;
    let layoutBaseOffset = 0;
    let lastTimestamp: number | null = null;
    let animationStopped = false;
    let currentXSpacing = 1;

    const layoutCircles = (
      viewWidth: number,
      viewHeight: number,
      columnWorldOffset = 0,
    ) => {
      const diameter = Math.max(0.2, Math.min(viewWidth * 0.07, viewHeight * 0.12));
      const xSpacing = diameter * X_SPACING_MULTIPLIER;
      const ySpacing = diameter * Y_SPACING_MULTIPLIER;
      const radius = diameter * 0.5;
      const safetyPadding = Math.max(diameter * 0.12, 0.2);
      currentXSpacing = xSpacing;
      const baseOffset = 0;
      layoutBaseOffset = baseOffset;

      const halfWidth = viewWidth * 0.5;
      const halfHeight = viewHeight * 0.5;
      const corners = [
        { x: -halfWidth, y: -halfHeight },
        { x: -halfWidth, y: halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
      ];

      let minLocalX = Number.POSITIVE_INFINITY;
      let maxLocalX = Number.NEGATIVE_INFINITY;
      let minLocalY = Number.POSITIVE_INFINITY;
      let maxLocalY = Number.NEGATIVE_INFINITY;

      for (const corner of corners) {
        const localX = corner.x * GRID_COS + corner.y * GRID_SIN - baseOffset;
        const localY = -corner.x * GRID_SIN + corner.y * GRID_COS;
        if (localX < minLocalX) minLocalX = localX;
        if (localX > maxLocalX) maxLocalX = localX;
        if (localY < minLocalY) minLocalY = localY;
        if (localY > maxLocalY) maxLocalY = localY;
      }

      const margin = radius + safetyPadding;
      minLocalX -= margin;
      maxLocalX += margin;
      minLocalY -= margin;
      maxLocalY += margin;

      const rowMin = Math.floor(minLocalY / ySpacing) - 1;
      const rowMax = Math.ceil(maxLocalY / ySpacing) + 1;

      const rows: Array<{ row: number; shift: number; cMin: number; cMax: number }> = [];
      let requiredCount = 0;

      for (let row = rowMin; row <= rowMax; row += 1) {
        const shift = (row & 1) !== 0 ? 0.5 : 0;
        const cMin = Math.floor(minLocalX / xSpacing - shift) - 1;
        const cMax = Math.ceil(maxLocalX / xSpacing - shift) + 1;
        if (cMax < cMin) {
          continue;
        }
        rows.push({ row, shift, cMin, cMax });
        requiredCount += cMax - cMin + 1;
      }

      if (requiredCount <= 0) {
        ensureInstanceCapacity(0);
        baseInstancesRef.current = [];
        baseOpacityRef.current = new Float32Array(0);
        layoutStateRef.current = {
          ...layoutStateRef.current,
          hasData: false,
        };
        return;
      }

      ensureInstanceCapacity(requiredCount);
      if (!instancedCircles || !instanceOpacityAttribute) {
        return;
      }

      const opacityArray = instanceOpacityAttribute.array as Float32Array;
      baseInstancesRef.current = new Array<BaseInstanceData>(requiredCount);
      baseOpacityRef.current = new Float32Array(requiredCount);
      const baseInstances = baseInstancesRef.current;
      const baseOpacityValues = baseOpacityRef.current;

      let index = 0;
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      const baseZ = GRID_PLANE_Z;

      for (const { row, shift, cMin, cMax } of rows) {
        const y = row * ySpacing;
        tempQuaternion.identity();
        tempScale.set(diameter, diameter, 1);

        for (let col = cMin; col <= cMax; col += 1) {
          const x = (col + shift) * xSpacing;
          const worldCol = col + columnWorldOffset;

          tempPosition.set(x, y, baseZ);
          tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
          instancedCircles.setMatrixAt(index, tempMatrix);

          const rotatedX = x * GRID_COS - y * GRID_SIN;
          const rotatedY = x * GRID_SIN + y * GRID_COS;
          if (rotatedX - radius < minX) minX = rotatedX - radius;
          if (rotatedX + radius > maxX) maxX = rotatedX + radius;
          if (rotatedY - radius < minY) minY = rotatedY - radius;
          if (rotatedY + radius > maxY) maxY = rotatedY + radius;

          const intensityRoll = randomForCell(row, worldCol, 0);
          let opacity = MIN_OPACITY;
          if (intensityRoll < 0.015) {
            opacity = 1;
          } else if (intensityRoll < 0.055) {
            opacity = HALF_OPACITY;
          } else {
            const base = Math.pow(randomForCell(row, worldCol, 1), FALLOFF_POWER);
            const jitter = 0.82 + randomForCell(row, worldCol, 2) * 0.35;
            const value = MIN_OPACITY + (HALF_OPACITY - MIN_OPACITY) * base * jitter;
            opacity = Math.min(HALF_OPACITY - 0.05, Math.max(MIN_OPACITY, value));
          }
          opacityArray[index] = opacity;
          baseOpacityValues[index] = opacity;
          baseInstances[index] = {
            baseX: x,
            baseY: y,
            row,
            col,
            shift,
            worldColumn: worldCol,
            baseOpacity: opacity,
          };

          index += 1;
        }
      }

      instancedCircles.count = requiredCount;
      instancedCircles.instanceMatrix.needsUpdate = true;
      instanceOpacityAttribute.needsUpdate = true;

      const centerX = (minX + maxX) * 0.5;
      const centerY = (minY + maxY) * 0.5;
      const offsetX = -baseOffset * GRID_COS;
      const offsetY = -baseOffset * GRID_SIN;
      circlesGroup.position.set(-centerX + offsetX, -centerY + offsetY, 0);
      const amplitude = 1;
      layoutStateRef.current = {
        hasData: true,
        xSpacing,
        diameter,
        baseZ,
        scaleX: diameter,
        scaleY: diameter,
        amplitude,
        secondaryAmplitude: 0.15,
        rippleAmplitude: 0.05,
        waveLength: 4.0,
      };
    };

    const renderScene = () => {
      renderer.render(scene, camera);
    };

    const applyWaveAnimation = (timeSeconds: number) => {
      if (!instancedCircles || !instanceOpacityAttribute) {
        return;
      }
      const layoutState = layoutStateRef.current;
      if (!layoutState.hasData) {
        return;
      }
      const {
        xSpacing,
        amplitude,
        secondaryAmplitude,
        rippleAmplitude,
        waveLength,
        baseZ,
        scaleX,
        scaleY,
      } = layoutState;
      const baseInstances = baseInstancesRef.current;
      const baseOpacities = baseOpacityRef.current;
      const count = instancedCircles.count;
      if (
        count <= 0 ||
        baseInstances.length < count ||
        baseOpacities.length < count ||
        xSpacing === 0 ||
        waveLength === 0
      ) {
        return;
      }

      const waveParams = waveParamsRef.current;
      const opacityArray = instanceOpacityAttribute.array as Float32Array;
      const amplitudeSafe = Math.max(1e-6, amplitude);
      tempQuaternion.identity();
      tempScale.set(scaleX, scaleY, 1);
      const globalScrollOffset = scrollOffset;

      for (let index = 0; index < count; index += 1) {
        const data = baseInstances[index];
        if (!data) {
          continue;
        }

        const worldX =
          (data.worldColumn + data.shift) * xSpacing - globalScrollOffset;
        const worldZ = data.baseY;

        const primaryWave =
          Math.sin(worldX / waveLength + timeSeconds * waveParams.speed) *
          amplitude;

        const secondaryWave =
          Math.sin(
            worldZ / (waveLength * 0.7) +
              worldX / (waveLength * 1.3) +
              timeSeconds * waveParams.speed * waveParams.secondaryFrequency
          ) * secondaryAmplitude;

        const ripples =
          Math.sin(
            worldX * waveParams.rippleFrequencyX +
              worldZ * waveParams.rippleFrequencyZ +
              timeSeconds * waveParams.rippleSpeed
          ) * rippleAmplitude;

        const totalWaveHeight = primaryWave + secondaryWave + ripples;

        tempPosition.set(
          data.baseX,
          data.baseY,
          baseZ + totalWaveHeight
        );
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        instancedCircles.setMatrixAt(index, tempMatrix);

        const waveIntensity = THREE.MathUtils.clamp(
          (totalWaveHeight + amplitudeSafe) / (amplitudeSafe * 2),
          0,
          1
        );

        const pulsePhase =
          (timeSeconds * waveParams.pulseSpeed +
            worldX * waveParams.pulseSpatialX +
            worldZ * waveParams.pulseSpatialZ) %
          (Math.PI * 2);
        const pulseIntensity = (Math.sin(pulsePhase) + 1) * 0.5;
        const sharpPulse = Math.pow(pulseIntensity, 0.3);
        const baseMultiplier = THREE.MathUtils.lerp(0.9, 1.1, waveIntensity);
        const highlightMultiplier = THREE.MathUtils.lerp(1.0, 1.2, sharpPulse);
        const finalMultiplier = baseMultiplier * highlightMultiplier;

        opacityArray[index] = Math.min(
          1,
          baseOpacities[index] * finalMultiplier
        );
      }

      instancedCircles.instanceMatrix.needsUpdate = true;
      instanceOpacityAttribute.needsUpdate = true;
    };

    const updateSize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) {
        return;
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
      renderer.setSize(clientWidth, clientHeight, false);

      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();

      const distanceToPlane = camera.position.z - GRID_PLANE_Z;
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const viewHeight = 2 * Math.tan(verticalFov / 2) * distanceToPlane;
      const viewWidth = viewHeight * camera.aspect;

      currentWidth = clientWidth;
      currentHeight = clientHeight;
      currentViewWidth = viewWidth;
      currentViewHeight = viewHeight;
      scrollOffset = 0;
      layoutBaseOffset = 0;
      worldColumnOffset = 0;
      scrollGroup.position.set(0, 0, 0);
      lastTimestamp = null;
      layoutCircles(currentViewWidth, currentViewHeight, worldColumnOffset);
      applyWaveAnimation(0);
      renderScene();
    };

    const loader = new THREE.TextureLoader();
    loader.load(
      "/circle.svg",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        circleMaterial.map = texture;
        circleMaterial.opacity = 1;
        circleMaterial.needsUpdate = true;
        renderScene();
      },
      undefined,
      () => {
        console.warn("Failed to load circle.svg texture");
      },
    );

    updateSize();

    const animate = (timestamp: number) => {
      if (animationStopped) {
        return;
      }
      const timeSeconds = timestamp / 1000;
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
        applyWaveAnimation(timeSeconds);
        renderScene();
        return;
      }
      const deltaSeconds = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;
      if (deltaSeconds <= 0) {
        renderScene();
        return;
      }

      if (
        currentWidth <= 0 ||
        currentHeight <= 0 ||
        currentViewWidth <= 0 ||
        currentViewHeight <= 0
      ) {
        renderScene();
        return;
      }

      scrollOffset += deltaSeconds * HORIZONTAL_SCROLL_SPEED;
      const spacing = currentXSpacing > 0 ? currentXSpacing : 1;
      let offsetDelta = scrollOffset - worldColumnOffset * spacing - layoutBaseOffset;
      let layoutNeedsUpdate = false;
      if (Math.abs(offsetDelta) >= spacing) {
        const steps = Math.trunc(offsetDelta / spacing);
        if (steps !== 0) {
          worldColumnOffset += steps;
          layoutNeedsUpdate = true;
        }
      }

      if (layoutNeedsUpdate && currentViewWidth > 0 && currentViewHeight > 0) {
        layoutCircles(currentViewWidth, currentViewHeight, worldColumnOffset);
        offsetDelta = scrollOffset - worldColumnOffset * spacing - layoutBaseOffset;
      }

      applyWaveAnimation(timeSeconds);

      const worldX = -offsetDelta * GRID_COS;
      const worldY = -offsetDelta * GRID_SIN;
      scrollGroup.position.set(worldX, worldY, 0);
      renderScene();
    };

    renderer.setAnimationLoop(animate);

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(container);

    window.addEventListener("resize", updateSize);
    window.addEventListener("orientationchange", updateSize);

    return () => {
      window.removeEventListener("resize", updateSize);
      window.removeEventListener("orientationchange", updateSize);
      resizeObserver.disconnect();
      animationStopped = true;
      renderer.setAnimationLoop(null);
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      if (instancedCircles) {
        circlesGroup.remove(instancedCircles);
        instancedCircles.dispose();
      }
      instancedCircles = null;
      instanceOpacityAttribute = null;
      instanceCapacity = 0;
      baseInstancesRef.current = [];
      baseOpacityRef.current = new Float32Array(0);
      layoutStateRef.current = {
        hasData: false,
        xSpacing: 1,
        ySpacing: 1,
        diameter: 1,
        baseZ: GRID_PLANE_Z,
        scaleX: 1,
        scaleY: 1,
        amplitude: 1,
        secondaryAmplitude: 0.15,
        rippleAmplitude: 0.05,
        waveLength: 4,
      };
      circleGeometry.dispose();
      circleMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: "fixed", inset: 0, overflow: "hidden", ...style }}
    />
  );
}

export default CircleWallpaper;
