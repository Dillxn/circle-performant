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
const HORIZONTAL_SCROLL_SPEED = 80;

export type CircleWallpaperProps = {
  style?: CSSProperties;
};

export function CircleWallpaper({ style }: CircleWallpaperProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);

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

    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -100, 100);
    camera.position.z = 10;

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
    let scrollOffset = 0;
    let worldColumnOffset = 0;
    let layoutBaseOffset = 0;
    let lastTimestamp: number | null = null;
    let animationStopped = false;
    let currentXSpacing = 1;

    const layoutCircles = (width: number, height: number, columnWorldOffset = 0) => {
      const diameter = Math.max(1, Math.min(width * 0.075, height * 0.18));
      const xSpacing = diameter * X_SPACING_MULTIPLIER;
      const ySpacing = diameter * Y_SPACING_MULTIPLIER;
      const radius = diameter * 0.5;
      const safetyPadding = Math.max(4, diameter * 0.1);
      currentXSpacing = xSpacing;
      const baseOffset = 0;
      layoutBaseOffset = baseOffset;

      const halfWidth = width * 0.5;
      const halfHeight = height * 0.5;
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
        return;
      }

      ensureInstanceCapacity(requiredCount);
      if (!instancedCircles || !instanceOpacityAttribute) {
        return;
      }

      const opacityArray = instanceOpacityAttribute.array as Float32Array;

      let index = 0;
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      for (const { row, shift, cMin, cMax } of rows) {
        const y = row * ySpacing;
        tempQuaternion.identity();
        tempScale.set(diameter, diameter, 1);

        for (let col = cMin; col <= cMax; col += 1) {
          const x = (col + shift) * xSpacing;
          const worldCol = col + columnWorldOffset;

          tempPosition.set(x, y, 5);
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
    };

    const renderScene = () => {
      renderer.render(scene, camera);
    };

    const updateSize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) {
        return;
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
      renderer.setSize(clientWidth, clientHeight, false);

      camera.left = -clientWidth / 2;
      camera.right = clientWidth / 2;
      camera.top = clientHeight / 2;
      camera.bottom = -clientHeight / 2;
      camera.updateProjectionMatrix();

      currentWidth = clientWidth;
      currentHeight = clientHeight;
      scrollOffset = 0;
      layoutBaseOffset = 0;
      worldColumnOffset = 0;
      scrollGroup.position.set(0, 0, 0);
      lastTimestamp = null;
      layoutCircles(currentWidth, currentHeight, worldColumnOffset);
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
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
        renderScene();
        return;
      }
      const deltaSeconds = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;
      if (deltaSeconds <= 0) {
        renderScene();
        return;
      }

      if (currentWidth <= 0 || currentHeight <= 0) {
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

      if (layoutNeedsUpdate) {
        layoutCircles(currentWidth, currentHeight, worldColumnOffset);
        offsetDelta = scrollOffset - worldColumnOffset * spacing - layoutBaseOffset;
      }

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
