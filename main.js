const canvas = document.getElementById("canvas");

const WIDTH = 1920;
const HEIGHT = 1080;

canvas.width = WIDTH;
canvas.height = HEIGHT;

canvas.style.width = "100vw";
canvas.style.height = "100vh";

if (!navigator.gpu) {
    throw new Error("WebGPU를 지원하지 않는 브라우저입니다.");
}

const adapter = await navigator.gpu.requestAdapter();

if (!adapter) {
    throw new Error("GPU adapter를 찾을 수 없습니다.");
}

const device = await adapter.requestDevice();

const context = canvas.getContext("webgpu");

const format = navigator.gpu.getPreferredCanvasFormat();

context.configure({
    device,
    format,
    alphaMode: "opaque",
});


// ============================================================
// Scene
// ============================================================

const disk = {
    innerRadius: 6,
    outerRadius: 9,
    rotationX: -84 * Math.PI / 180,
};

const blackHole = {
    x: 0,
    y: 0,
    z: 0,

    mass: 3,
    absorbRadius: 2,
};

const step = 0.1;
const maxSteps = 1500;


// ============================================================
// Camera
// ============================================================

const camera = {
    yaw: 0,
    pitch: 0,
    distance: 15,

    x: 0,
    y: 0,
    z: -15,
};

let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

const mouseSensitivity = 0.005;

const minDistance = 5;
const maxDistance = 40;

const minPitch = -Math.PI / 2 + 0.05;
const maxPitch = Math.PI / 2 - 0.05;


// ============================================================
// Uniform
//
// 7 x vec4<f32>
// = 7 x 16 bytes
// = 112 bytes
//
// 0  : camera
// 4  : forward
// 8  : right
// 12 : up
// 16 : disk
// 20 : black hole
// 24 : render
// ============================================================

const uniformData = new Float32Array(28);

const uniformBuffer = device.createBuffer({
    size: 112,
    usage:
        GPUBufferUsage.UNIFORM |
        GPUBufferUsage.COPY_DST,
});


// ============================================================
// Shader
// ============================================================

const shaderModule = device.createShaderModule({
    code: /* wgsl */`

struct Params {
    camera : vec4<f32>,
    forward : vec4<f32>,
    right : vec4<f32>,
    up : vec4<f32>,

    disk : vec4<f32>,
    blackHole : vec4<f32>,
    render : vec4<f32>,
};

@group(0) @binding(0)
var<uniform> params : Params;

@group(0) @binding(1)
var outputTexture : texture_storage_2d<rgba8unorm, write>;


// ============================================================
// Utility
// ============================================================

fn normalize3(v : vec3<f32>) -> vec3<f32> {
    return normalize(v);
}


// ============================================================
// Ray tracing
// ============================================================

fn traceRay(
    origin : vec3<f32>,
    direction : vec3<f32>
) -> vec3<f32> {

    var position = origin;
    var rayDirection = normalize(direction);

    let mass = params.blackHole.x;
    let absorbRadius = params.blackHole.y;
    let stepSize = params.blackHole.z;
    let maxIteration = i32(params.blackHole.w);

    let diskInner = params.disk.x;
    let diskOuter = params.disk.y;
    let diskCos = params.disk.z;
    let diskSin = params.disk.w;

    var previousPosition = position;

    for (var i = 0; i < 2000; i++) {

        if (i >= maxIteration) {
            break;
        }

        previousPosition = position;

        // --------------------------------------------
        // Distance from black hole
        // --------------------------------------------

        let toBlackHole = -position;

        let distance = length(toBlackHole);


        // --------------------------------------------
        // Event horizon / absorption
        // --------------------------------------------

        if (distance < absorbRadius) {
            return vec3<f32>(0.0, 0.0, 0.0);
        }


        // --------------------------------------------
        // Accretion disk intersection
        // --------------------------------------------

        // --------------------------------------------
        // Accretion disk intersection
        // --------------------------------------------

        // Rotated disk plane.
        //
        // rotationX:
        //   x axis rotation
        //
        // Plane equation:
        //   y' = y * cosX - z * sinX
        //
        // Disk center:
        //   (0, 0, 0)

        let previousPlane =
            previousPosition.y * diskCos -
            previousPosition.z * diskSin;

        let currentPlane =
            position.y * diskCos -
            position.z * diskSin;


        // Did the ray segment cross the disk plane?
        if (
            (previousPlane <= 0.0 && currentPlane >= 0.0) ||
            (previousPlane >= 0.0 && currentPlane <= 0.0)
        ) {

            let denominator =
                currentPlane - previousPlane;

            if (abs(denominator) > 0.000001) {

                let t =
                    -previousPlane / denominator;

                let hitPosition =
                    previousPosition +
                    (position - previousPosition) * t;


                // ----------------------------------------
                // Transform hit position back into
                // the disk's local coordinate system
                // ----------------------------------------

                let diskX =
                    hitPosition.x;

                let diskZ =
                    hitPosition.y * diskSin +
                    hitPosition.z * diskCos;


                let radius =
                    sqrt(
                        diskX * diskX +
                        diskZ * diskZ
                    );


                // ----------------------------------------
                // Inside accretion disk?
                // ----------------------------------------

                if (
                    radius >= diskInner &&
                    radius <= diskOuter
                ) {

                    let normalizedRadius =
                        (radius - diskInner) /
                        (diskOuter - diskInner);


                    // Brighter near inner edge
                    let brightness =
                        1.0 -
                        normalizedRadius * 0.7;


                    return vec3<f32>(
                        1.0 * brightness,
                        0.32 * brightness,
                        0.03 * brightness
                    );
                }
            }
        }


        // --------------------------------------------
        // Escape
        // --------------------------------------------

        if (
            abs(position.x) > 30.0 ||
            abs(position.y) > 30.0 ||
            abs(position.z) > 30.0
        ) {

            return vec3<f32>(
                0.0,
                0.0,
                0.0
            );
        }


        // --------------------------------------------
        // Gravity
        // --------------------------------------------

        let distanceSquared =
            max(
                distance * distance,
                0.0001
            );

        let gravity =
            mass / distanceSquared;

        rayDirection +=
            normalize(toBlackHole) *
            gravity *
            stepSize;

        rayDirection =
            normalize(rayDirection);


        // --------------------------------------------
        // Move ray
        // --------------------------------------------

        position +=
            rayDirection *
            stepSize;
    }


    // Ray escaped / no hit.
    return vec3<f32>(
        0.0,
        0.0,
        0.0
    );
}


// ============================================================
// Compute shader
// ============================================================

@compute
@workgroup_size(8, 8)
fn main(
    @builtin(global_invocation_id)
    id : vec3<u32>
) {

    let width =
        u32(params.render.x);

    let height =
        u32(params.render.y);


    if (
        id.x >= width ||
        id.y >= height
    ) {
        return;
    }


    let pixelX =
        f32(id.x);

    let pixelY =
        f32(id.y);


    // --------------------------------------------
    // Normalized screen coordinates
    //
    // -0.5 ~ +0.5
    // --------------------------------------------

    let normalizedX =
        pixelX / f32(width) - 0.5;

    // 화면 Y 방향을 뒤집어서
    // 일반적인 카메라 좌표계처럼 사용
    let normalizedY =
        0.5 - pixelY / f32(height);


    // --------------------------------------------
    // Camera basis
    // --------------------------------------------

    let forward =
        params.forward.xyz;

    let right =
        params.right.xyz;

    let up =
        params.up.xyz;


    // --------------------------------------------
    // Ray direction
    //
    // 기존 카메라:
    //
    // camera  = (0, 0, -15)
    // plane   = z = -5
    // width   = 24
    // height  = 18
    //
    // camera -> plane distance = 10
    //
    // 따라서:
    //
    // x / 10 = normalizedX * 2.4
    // y / 10 = normalizedY * 1.8
    // --------------------------------------------

    var rayDirection =
        forward
        + right * normalizedX * 2.4
        + up * normalizedY * 1.8;

    rayDirection =
        normalize(rayDirection);


    // --------------------------------------------
    // Trace
    // --------------------------------------------

    let color =
        traceRay(
            params.camera.xyz,
            rayDirection
        );


    textureStore(
        outputTexture,
        vec2<i32>(
            i32(id.x),
            i32(id.y)
        ),
        vec4<f32>(
            color,
            1.0
        )
    );
}


// ============================================================
// Render shader
// ============================================================

struct VertexOutput {
    @builtin(position)
    position : vec4<f32>,

    @location(0)
    uv : vec2<f32>,
};


@vertex
fn vs(
    @builtin(vertex_index)
    vertexIndex : u32
) -> VertexOutput {

    var positions =
        array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>(-1.0,  1.0),

            vec2<f32>(-1.0,  1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>( 1.0,  1.0)
        );

    var uvs =
        array<vec2<f32>, 6>(
            vec2<f32>(0.0, 1.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(0.0, 0.0),

            vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(1.0, 0.0)
        );


    var output : VertexOutput;

    output.position =
        vec4<f32>(
            positions[vertexIndex],
            0.0,
            1.0
        );

    output.uv =
        uvs[vertexIndex];

    return output;
}


@group(0) @binding(0)
var renderTexture :
    texture_2d<f32>;

@group(0) @binding(1)
var renderSampler :
    sampler;


@fragment
fn fs(
    input : VertexOutput
) -> @location(0) vec4<f32> {

    return textureSample(
        renderTexture,
        renderSampler,
        input.uv
    );
}
`,
});


// ============================================================
// Output texture
// ============================================================

const outputTexture = device.createTexture({
    size: [WIDTH, HEIGHT],

    format: "rgba8unorm",

    usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING,
});


// ============================================================
// Compute bind group
// ============================================================

const computeBindGroupLayout =
    device.createBindGroupLayout({
        entries: [

            {
                binding: 0,

                visibility:
                    GPUShaderStage.COMPUTE,

                buffer: {
                    type: "uniform",
                },
            },

            {
                binding: 1,

                visibility:
                    GPUShaderStage.COMPUTE,

                storageTexture: {
                    access: "write-only",
                    format: "rgba8unorm",
                },
            },
        ],
    });


const computePipeline =
    device.createComputePipeline({
        layout:
            device.createPipelineLayout({
                bindGroupLayouts: [
                    computeBindGroupLayout,
                ],
            }),

        compute: {
            module: shaderModule,
            entryPoint: "main",
        },
    });


const computeBindGroup =
    device.createBindGroup({

        layout:
            computeBindGroupLayout,

        entries: [

            {
                binding: 0,

                resource: {
                    buffer: uniformBuffer,
                },
            },

            {
                binding: 1,

                resource:
                    outputTexture.createView(),
            },
        ],
    });


// ============================================================
// Render bind group
// ============================================================

const sampler =
    device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
    });


const renderBindGroupLayout =
    device.createBindGroupLayout({
        entries: [

            {
                binding: 0,

                visibility:
                    GPUShaderStage.FRAGMENT,

                texture: {},
            },

            {
                binding: 1,

                visibility:
                    GPUShaderStage.FRAGMENT,

                sampler: {},
            },
        ],
    });


const renderPipeline =
    device.createRenderPipeline({

        layout:
            device.createPipelineLayout({
                bindGroupLayouts: [
                    renderBindGroupLayout,
                ],
            }),

        vertex: {
            module: shaderModule,
            entryPoint: "vs",
        },

        fragment: {
            module: shaderModule,

            entryPoint: "fs",

            targets: [
                {
                    format,
                },
            ],
        },

        primitive: {
            topology: "triangle-list",
        },
    });


const renderBindGroup =
    device.createBindGroup({

        layout:
            renderBindGroupLayout,

        entries: [

            {
                binding: 0,

                resource:
                    outputTexture.createView(),
            },

            {
                binding: 1,

                resource:
                    sampler,
            },
        ],
    });


// ============================================================
// Camera update
// ============================================================

function updateCamera() {

    const cosPitch =
        Math.cos(camera.pitch);

    const sinPitch =
        Math.sin(camera.pitch);

    const sinYaw =
        Math.sin(camera.yaw);

    const cosYaw =
        Math.cos(camera.yaw);


    // --------------------------------------------
    // Camera position
    //
    // Sphere coordinates around origin
    // --------------------------------------------

    camera.x =
        sinYaw *
        cosPitch *
        camera.distance;

    camera.y =
        sinPitch *
        camera.distance;

    camera.z =
        -cosYaw *
        cosPitch *
        camera.distance;


    // --------------------------------------------
    // Forward
    //
    // Always look toward origin.
    // --------------------------------------------

    let forwardX =
        -camera.x;

    let forwardY =
        -camera.y;

    let forwardZ =
        -camera.z;


    const forwardLength =
        Math.sqrt(
            forwardX * forwardX +
            forwardY * forwardY +
            forwardZ * forwardZ
        );


    forwardX /= forwardLength;
    forwardY /= forwardLength;
    forwardZ /= forwardLength;


    // --------------------------------------------
    // Right
    //
    // forward × worldUp
    // --------------------------------------------

    const worldUpX = 0;
    const worldUpY = 1;
    const worldUpZ = 0;


    let rightX =
        forwardY * worldUpZ -
        forwardZ * worldUpY;

    let rightY =
        forwardZ * worldUpX -
        forwardX * worldUpZ;

    let rightZ =
        forwardX * worldUpY -
        forwardY * worldUpX;


    const rightLength =
        Math.sqrt(
            rightX * rightX +
            rightY * rightY +
            rightZ * rightZ
        );


    rightX /= rightLength;
    rightY /= rightLength;
    rightZ /= rightLength;


    // --------------------------------------------
    // Up
    //
    // right × forward
    // --------------------------------------------

    const upX =
        rightY * forwardZ -
        rightZ * forwardY;

    const upY =
        rightZ * forwardX -
        rightX * forwardZ;

    const upZ =
        rightX * forwardY -
        rightY * forwardX;


    // --------------------------------------------
    // Write uniform
    // --------------------------------------------

    // camera
    uniformData[0] = camera.x;
    uniformData[1] = camera.y;
    uniformData[2] = camera.z;
    uniformData[3] = 0;


    // forward
    uniformData[4] = forwardX;
    uniformData[5] = forwardY;
    uniformData[6] = forwardZ;
    uniformData[7] = 0;


    // right
    uniformData[8] = rightX;
    uniformData[9] = rightY;
    uniformData[10] = rightZ;
    uniformData[11] = 0;


    // up
    uniformData[12] = upX;
    uniformData[13] = upY;
    uniformData[14] = upZ;
    uniformData[15] = 0;


    device.queue.writeBuffer(
        uniformBuffer,
        0,
        uniformData
    );
}


// ============================================================
// Static scene uniforms
// ============================================================

function updateSceneUniforms() {

    const diskCos =
        Math.cos(disk.rotationX);

    const diskSin =
        Math.sin(disk.rotationX);


    // disk
    uniformData[16] =
        disk.innerRadius;

    uniformData[17] =
        disk.outerRadius;

    uniformData[18] =
        diskCos;

    uniformData[19] =
        diskSin;


    // black hole
    uniformData[20] =
        blackHole.mass;

    uniformData[21] =
        blackHole.absorbRadius;

    uniformData[22] =
        step;

    uniformData[23] =
        maxSteps;


    // render
    uniformData[24] =
        WIDTH;

    uniformData[25] =
        HEIGHT;

    uniformData[26] = 0;
    uniformData[27] = 0;


    device.queue.writeBuffer(
        uniformBuffer,
        0,
        uniformData
    );
}


// ============================================================
// Render
// ============================================================

let renderPending = false;
let rendering = false;

function requestRender() {

    if (renderPending) {
        return;
    }

    renderPending = true;

    requestAnimationFrame(() => {

        renderPending = false;

        render();

    });
}


function render() {

    if (rendering) {
        return;
    }

    rendering = true;


    const commandEncoder =
        device.createCommandEncoder();


    // --------------------------------------------
    // Compute
    // --------------------------------------------

    const computePass =
        commandEncoder.beginComputePass();


    computePass.setPipeline(
        computePipeline
    );

    computePass.setBindGroup(
        0,
        computeBindGroup
    );


    computePass.dispatchWorkgroups(
        Math.ceil(WIDTH / 8),
        Math.ceil(HEIGHT / 8)
    );


    computePass.end();


    // --------------------------------------------
    // Render
    // --------------------------------------------

    const renderPass =
        commandEncoder.beginRenderPass({

            colorAttachments: [

                {
                    view:
                        context
                            .getCurrentTexture()
                            .createView(),

                    clearValue: {
                        r: 0,
                        g: 0,
                        b: 0,
                        a: 1,
                    },

                    loadOp: "clear",

                    storeOp: "store",
                },

            ],

        });


    renderPass.setPipeline(
        renderPipeline
    );

    renderPass.setBindGroup(
        0,
        renderBindGroup
    );

    renderPass.draw(6);

    renderPass.end();


    device.queue.submit([
        commandEncoder.finish(),
    ]);


    rendering = false;
}


// ============================================================
// Mouse controls
// ============================================================

canvas.addEventListener(
    "mousedown",
    (event) => {

        isDragging = true;

        lastMouseX =
            event.clientX;

        lastMouseY =
            event.clientY;

        canvas.style.cursor =
            "grabbing";
    }
);


window.addEventListener(
    "mouseup",
    () => {

        isDragging = false;

        canvas.style.cursor =
            "grab";
    }
);


window.addEventListener(
    "mousemove",
    (event) => {

        if (!isDragging) {
            return;
        }


        const deltaX =
            event.clientX -
            lastMouseX;

        const deltaY =
            event.clientY -
            lastMouseY;


        lastMouseX =
            event.clientX;

        lastMouseY =
            event.clientY;


        camera.yaw -=
            deltaX *
            mouseSensitivity;

        camera.pitch -=
            deltaY *
            mouseSensitivity;


        camera.pitch =
            Math.max(
                minPitch,
                Math.min(
                    maxPitch,
                    camera.pitch
                )
            );


        updateCamera();

        requestRender();
    }
);


// ============================================================
// Wheel zoom
// ============================================================

canvas.addEventListener(
    "wheel",
    (event) => {

        event.preventDefault();


        const zoomSpeed = 0.01;


        camera.distance *=
            Math.exp(
                event.deltaY *
                zoomSpeed
            );


        camera.distance =
            Math.max(
                minDistance,
                Math.min(
                    maxDistance,
                    camera.distance
                )
            );


        updateCamera();

        requestRender();
    },
    {
        passive: false,
    }
);


// ============================================================
// Initial setup
// ============================================================

canvas.style.cursor = "grab";

updateSceneUniforms();
updateCamera();

requestRender();

console.log("WebGPU black hole renderer ready.");
