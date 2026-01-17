import puppeteer from "puppeteer";

const WIDTH = 1920;
const HEIGHT = 1080;
const FRAMES = 180;

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: WIDTH, height: HEIGHT }
  });

  const page = await browser.newPage();

  await page.setContent(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: black;
  }
  canvas { display: block; }
</style>
</head>
<body>
<script type="module">
import * as THREE from "https://esm.sh/three@0.158.0";

/* ================= SCENE ================= */
const scene = new THREE.Scene();

/* ================= CAMERA ================= */
const camera = new THREE.PerspectiveCamera(35, ${WIDTH}/${HEIGHT}, 0.1, 100);
camera.position.set(0, 0, 12);

/* ================= RENDERER ================= */
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true
});
renderer.setSize(${WIDTH}, ${HEIGHT});
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

/* ================= LIGHTS ================= */
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(5, 3, 5);
scene.add(sun);

/* ================= BACKGROUND ================= */
new THREE.TextureLoader().load(
  "https://cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png",
  tex => scene.background = tex
);

/* ================= TEXTURES ================= */
const loader = new THREE.TextureLoader();

const earthMap = loader.load(
  "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg"
);
const bumpMap = loader.load(
  "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png"
);
const specMap = loader.load(
  "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-water.png"
);

/* ================= EARTH ================= */
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(2, 64, 64),
  new THREE.MeshPhongMaterial({
    map: earthMap,
    bumpMap: bumpMap,
    bumpScale: 0.15,
    specularMap: specMap,
    specular: new THREE.Color("grey"),
    shininess: 15
  })
);
scene.add(earth);

/* ================= ATMOSPHERE ================= */
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(2.05, 64, 64),
  new THREE.MeshBasicMaterial({
    color: 0x4aa3ff,
    transparent: true,
    opacity: 0.15
  })
);
scene.add(atmosphere);

/* ================= HELPERS ================= */
/* ================= HELPERS ================= */
function latLngToXYZ(lat, lng, r) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lng + 180) * Math.PI / 180;

  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

/* ================= ARC (NY → LONDON) ================= */
const start = latLngToXYZ(40.7128, -74.0060, 2.05);
const end   = latLngToXYZ(51.5074, -0.1278, 2.05);

const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(2.8);
const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
const points = curve.getPoints(120);

const arc = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(points),
  new THREE.LineBasicMaterial({ color: 0xffaa00 })
);
scene.add(arc);

/* ================= CITY TARGET (DUBAI) ================= */
const cityLat = 10.400231;
const cityLng = 79.847881;
const cityTarget = latLngToXYZ(cityLat, cityLng, 2);
function createLabel(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = 512;
  canvas.height = 128;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.font = "48px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.2, 0.3, 1);

  return sprite;
}

/* ================= CITY MARKER ================= */
const cityMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.035, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xff3333 })
);

// place marker slightly above surface
cityMarker.position.copy(
  cityTarget.clone().normalize().multiplyScalar(2.035)
);

scene.add(cityMarker);
// ================= CITY LABEL =================
const cityLabel = createLabel("Thopputhurai");

cityLabel.position.copy(
  cityTarget.clone().normalize().multiplyScalar(2.15)
);

scene.add(cityLabel);



/* ================= ANIMATION ================= */
window.renderFrame = function(i) {
  const t = i / ${FRAMES};

  // smooth easing
  const ease = t * t * (3 - 2 * t);

  // zoom from space → city
  const startRadius = 12;
  const endRadius = 3.2;
  const radius = startRadius - ease * (startRadius - endRadius);

  const dir = cityTarget.clone().normalize();
  camera.position.copy(dir.multiplyScalar(radius));


  camera.lookAt(cityTarget);
  const pulse = 1 + Math.sin(i * 0.15) * 0.3;
  cityMarker.scale.set(pulse, pulse, pulse);
  cityLabel.quaternion.copy(camera.quaternion);
  renderer.render(scene, camera);
};
</script>
</body>
</html>
`);

  /* ================= RENDER FRAMES ================= */
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate(i => window.renderFrame(i), i);
    await page.screenshot({
      path: "frames/frame_" + String(i).padStart(3, "0") + ".png"
    });
  }

  await browser.close();
  console.log("Frames rendered");
})();
