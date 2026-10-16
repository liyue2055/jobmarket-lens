import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BufferGeometry, Color, InstancedMesh, Object3D, Vector3 } from "three";
import type { Mark } from "./types";

function Camera({
  preset,
  selecting,
  onCameraInteraction,
}: {
  preset: string;
  selecting: boolean;
  onCameraInteraction: () => void;
}) {
  const { camera, gl, invalidate } = useThree();
  const controls = useMemo(
    () => new OrbitControls(camera, gl.domElement),
    [camera, gl],
  );
  useEffect(() => {
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.minZoom = 8;
    controls.maxZoom = 85;
    controls.target.set(0, 0, 0);
    const changed = () => invalidate();
    controls.addEventListener("change", changed);
    controls.addEventListener("start", onCameraInteraction);
    return () => {
      controls.removeEventListener("change", changed);
      controls.removeEventListener("start", onCameraInteraction);
      controls.dispose();
    };
  }, [controls, invalidate, onCameraInteraction]);
  useEffect(() => {
    controls.enabled = !selecting;
  }, [controls, selecting]);
  useEffect(() => {
    const view = preset.split(":")[0];
    controls.target.set(0, 0, 0);
    if ("zoom" in camera) {
      camera.zoom = 23;
      camera.updateProjectionMatrix();
    }
    camera.position.set(
      ...((view === "front"
        ? [0, 0, 40]
        : view === "top"
          ? [0, 40, 0.01]
          : view === "side"
            ? [40, 0, 0.01]
            : [24, 20, 32]) as [number, number, number]),
    );
    camera.lookAt(0, 0, 0);
    controls.update();
    invalidate();
  }, [preset, camera, controls, invalidate]);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      canvas.dispatchEvent(
        new CustomEvent("spatial-context-lost", { bubbles: true }),
      );
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl]);
  return null;
}
function Marks({
  marks,
  selected,
  onPick,
  maxCount,
  onPreview,
}: {
  marks: Mark[];
  selected: string[];
  onPick: (id: string) => void;
  maxCount: number;
  onPreview: (ids: string[]) => void;
}) {
  const mesh = useRef<InstancedMesh>(null),
    { invalidate, camera, raycaster } = useThree();
  const max = Math.max(1, maxCount);
  const rotation = useRef(camera.quaternion.clone());
  const updateInstances = useCallback(() => {
    if (!mesh.current) return;
    const dummy = new Object3D();
    marks.forEach((mark, i) => {
      dummy.position.set(...mark.position);
      dummy.quaternion.copy(camera.quaternion);
      dummy.scale.setScalar(0.55 * Math.sqrt(mark.count / max));
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
      mesh.current!.setColorAt(
        i,
        new Color(
          selected.includes(mark.id) ? "#b06813" : mark.color || "#28776d",
        ),
      );
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    rotation.current.copy(camera.quaternion);
  }, [marks, selected, max, camera]);
  useEffect(() => {
    updateInstances();
    invalidate();
  }, [updateInstances, invalidate]);
  useFrame(() => {
    if (!rotation.current.equals(camera.quaternion)) updateInstances();
  });
  const hitIds = () =>
    mesh.current
      ? [
          ...new Set(
            raycaster
              .intersectObject(mesh.current)
              .flatMap((hit) =>
                hit.instanceId === undefined ? [] : [marks[hit.instanceId]?.id],
              )
              .filter((id): id is string => !!id),
          ),
        ]
      : [];
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, marks.length]}
      onPointerMove={(e) => {
        e.stopPropagation();
        onPreview(hitIds());
      }}
      onClick={(e) => {
        e.stopPropagation();
        onPreview(hitIds());
        if (e.instanceId !== undefined && marks[e.instanceId])
          onPick(marks[e.instanceId].id);
      }}
    >
      <circleGeometry args={[1, 24]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
}
export default function SpatialScene({
  marks,
  selected,
  onPick,
  preset,
  selecting,
  lens,
  links,
  maxCount,
  onPreview,
  onCameraInteraction,
}: {
  marks: Mark[];
  selected: string[];
  onPick: (id: string) => void;
  preset: string;
  selecting: boolean;
  lens: string;
  links: { a: string; b: string }[];
  maxCount: number;
  onPreview: (ids: string[]) => void;
  onCameraInteraction: () => void;
}) {
  return (
    <Canvas
      orthographic
      camera={{ position: [24, 20, 32], zoom: 23, near: 0.1, far: 300 }}
      dpr={[1, 1.5]}
      frameloop="demand"
      role="img"
      aria-label="Optional three-dimensional aggregate view. Use the exact cell list below for keyboard selection."
      style={{ height: "100%", background: "#f2f6f1" }}
    >
      <Camera
        preset={preset}
        selecting={selecting}
        onCameraInteraction={onCameraInteraction}
      />
      {lens === "demand_shelves" && <ShelfLines />}
      {lens === "skill_neighborhood" && (
        <GraphLinks marks={marks} links={links} />
      )}
      <gridHelper args={[28, 28, "#b8ccc1", "#e0e9e0"]} position={[0, -6, 0]} />
      <axesHelper args={[9]} />
      <Marks
        marks={marks}
        selected={selected}
        onPick={onPick}
        maxCount={maxCount}
        onPreview={onPreview}
      />
    </Canvas>
  );
}

function ShelfLines() {
  const geometry = useMemo(() => {
    const vertices: Vector3[] = [];
    for (const z of [-4.5, -1.5, 1.5, 4.5]) {
      for (let x = -11.5; x <= 11.5; x++)
        vertices.push(new Vector3(x, -5.4, z), new Vector3(x, 5.4, z));
      for (let y = -5.4; y <= 5.5; y += 1.35)
        vertices.push(new Vector3(-11.5, y, z), new Vector3(11.5, y, z));
    }
    return new BufferGeometry().setFromPoints(vertices);
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#d5e1d5" />
    </lineSegments>
  );
}
function GraphLinks({
  marks,
  links,
}: {
  marks: Mark[];
  links: { a: string; b: string }[];
}) {
  const geometry = useMemo(() => {
    const lookup = new Map(marks.map((m) => [m.id, m.position]));
    const points: Vector3[] = [];
    links.forEach((link) => {
      const a = lookup.get(link.a),
        b = lookup.get(link.b);
      if (a && b) points.push(new Vector3(...a), new Vector3(...b));
    });
    return new BufferGeometry().setFromPoints(points);
  }, [marks, links]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#b4cdbb" />
    </lineSegments>
  );
}
