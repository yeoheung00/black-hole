async function init() {
  if (!navigator.gpu) {
    alert("WebGPU를 지원하지 않는 브라우저입니다.");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("canvas");
  canvas.width = 800;
  canvas.height = 800;

  const context = canvas.getContext("webgpu");
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const diskData = new Float32Array([
    10.0, // innerRadius
    20.0, // outerRadius
    (-84.0 * Math.PI) / 180.0, // rotationX
    0.0, // time
  ]);

  const diskUniformBuffer = device.createBuffer({
    size: diskData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(diskUniformBuffer, 0, diskData);

  const shaderCode = `
      struct Disk {
        innerRadius : f32,
        outerRadius : f32,
        rotationX : f32,
        time : f32,
      }

      @group(0) @binding(0) var outputTexture : texture_storage_2d<rgba8unorm, write>;
      @group(0) @binding(1) var<uniform> disk : Disk;

      const cameraPos : vec3f = vec3f(0.0, 0.0, -34.0);
      const imagePlaneZ : f32 = -23.0;
      const screenWidth : f32 = 800.0;
      const screenHeight : f32 = 800.0;

      fn hash(p : vec2f) -> f32 {
        let p2 = fract(p * vec2f(123.34, 456.21));
        let p3 = p2 + dot(p2, p2 + 45.32);
        return fract(p3.x * p3.y);
      }

      fn noise(p : vec2f) -> f32 {
        let i = floor(p);
        let f = fract(p);
        let u = f * f * (3.0 - 2.0 * f);

        return mix(
          mix(hash(i + vec2f(0.0, 0.0)), hash(i + vec2f(1.0, 0.0)), u.x),
          mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
          u.y
        );
      }

      fn fbm(p : vec2f) -> f32 {
        var v = 0.0;
        var a = 0.5;
        var shift = vec2f(100.0);
        var pos = p;
        for (var i = 0; i < 3; i++) {
          v += a * noise(pos);
          pos = pos * 2.0 + shift;
          a *= 0.5;
        }
        return v;
      }

      fn sampleDiskVolume(pos : vec3f, rayDir : vec3f) -> vec4f {
        let cosAngle = cos(disk.rotationX);
        let sinAngle = sin(disk.rotationX);

        let localX = pos.x;
        let localY = pos.y * cosAngle + pos.z * sinAngle;
        let localZ = -pos.y * sinAngle + pos.z * cosAngle;

        let r = length(vec2f(localX, localY));
        if (r < disk.innerRadius || r > disk.outerRadius) {
          return vec4f(0.0);
        }

        let normR = (r - disk.innerRadius) / (disk.outerRadius - disk.innerRadius);

        let diskHeight = mix(1.2, 0.3, normR);
        if (abs(localZ) > diskHeight) {
          return vec4f(0.0);
        }

        let heightDecay = exp(-pow(localZ / (diskHeight * 0.6), 2.0));

        let baseTheta = atan2(localY, localX);
        let globalRotation = disk.time * 0.8;
        let theta = baseTheta - globalRotation;

        let arms = 3.0;
        let spiral = sin(theta * arms + normR * 8.0);

        let noiseUV = vec2f(spiral * 2.0 + localZ * 0.8, normR * 10.0 + disk.time * 0.2);
        let gasDensity = fbm(noiseUV) * heightDecay;

        let innerColor = vec3f(1.8, 2.0, 2.3);
        let midColor   = vec3f(1.0, 0.45, 0.05);
        let outerColor = vec3f(0.25, 0.01, 0.0);

        var baseColor = mix(innerColor, midColor, smoothstep(0.0, 0.25, normR));
        baseColor = mix(baseColor, outerColor, smoothstep(0.25, 1.0, normR));

        let gasVel = normalize(vec3f(-localY, localX * cosAngle, localX * sinAngle));
        let doppler = dot(gasVel, -rayDir);
        let dopplerFactor = clamp(1.0 + doppler * 1, 0.5, 1.8);

        let stepDensity = gasDensity * heightDecay * 0.8; // step 증가에 따른 밀도 보정
        let finalColor = baseColor * (gasDensity * 1.5 + 0.1) * dopplerFactor;

        return vec4f(finalColor, stepDensity);
      }

      fn traceRay(pixelX : f32, pixelY : f32) -> vec4f {
        let aspect = screenWidth / screenHeight;
        let imagePlaneHeight : f32 = 18.0;
        let imagePlaneWidth : f32 = imagePlaneHeight * aspect;

        let normalizedX = pixelX / screenWidth - 0.5;
        let normalizedY = pixelY / screenHeight - 0.5;

        let targetPos = vec3f(
          normalizedX * imagePlaneWidth,
          normalizedY * imagePlaneHeight,
          imagePlaneZ
        );

        var dir = normalize(targetPos - cameraPos);
        var pos = cameraPos;

        let blackHolePos = vec3f(0.0, 0.0, 0.0);
        let mass : f32 = 2.2;

        let step : f32 = 0.2;
        let maxSteps : u32 = 350u;

        var accumulatedColor = vec3f(0.0);
        var accumulatedAlpha = 0.0;

        for (var i = 0u; i < maxSteps; i++) {
          let toBlackHole = blackHolePos - pos;
          let dist = length(toBlackHole);

          if (dist < 2.0) {
            return vec4f(accumulatedColor, 1.0);
          }

          let gravityDir = toBlackHole / dist;
          let gravity = mass / (dist * dist);
          dir = normalize(dir + gravityDir * gravity * step);

          pos += dir * step;

          let sample = sampleDiskVolume(pos, dir);
          if (sample.a > 0.0) {
            let sampleAlpha = sample.a;
            let weight = (1.0 - accumulatedAlpha) * sampleAlpha;

            accumulatedColor += sample.rgb * weight;
            accumulatedAlpha += weight;

            if (accumulatedAlpha >= 0.95) {
              break;
            }
          }

          if (abs(pos.x) > 35.0 || abs(pos.y) > 35.0 || abs(pos.z) > 35.0) {
            break;
          }
        }

        return vec4f(accumulatedColor, accumulatedAlpha);
      }

      @compute @workgroup_size(16, 16)
      fn cs_main(@builtin(global_invocation_id) global_id : vec3u) {
        if (global_id.x >= u32(screenWidth) || global_id.y >= u32(screenHeight)) {
          return;
        }

        let color = traceRay(f32(global_id.x), f32(global_id.y));
        textureStore(outputTexture, vec2i(global_id.xy), color);
      }

      @group(0) @binding(0) var renderTexture : texture_2d<f32>;

      @vertex
      fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        var pos = array<vec2f, 6>(
          vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
          vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
        );
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment
      fn fs_main(@builtin(position) coord : vec4f) -> @location(0) vec4f {
        return textureLoad(renderTexture, vec2i(coord.xy), 0);
      }
    `;

  const shaderModule = device.createShaderModule({ code: shaderCode });

  const texture = device.createTexture({
    size: [800, 800],
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const textureView = texture.createView();

  const computePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "cs_main" },
  });

  const renderPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "vs_main" },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: presentationFormat }],
    },
    primitive: { topology: "triangle-list" },
  });

  const computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: textureView },
      { binding: 1, resource: { buffer: diskUniformBuffer } },
    ],
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: textureView }],
  });

  let isDragging = false;
  let previousMouseY = 0;
  let rotationX = diskData[2];

  canvas.addEventListener("pointerdown", (e) => {
    isDragging = true;
    previousMouseY = e.clientY;
  });

  window.addEventListener("pointerup", () => {
    isDragging = false;
  });

  window.addEventListener("pointermove", (e) => {
    if (!isDragging) return;

    const deltaY = e.clientY - previousMouseY;
    previousMouseY = e.clientY;

    rotationX += deltaY * 0.005;
    diskData[2] = rotationX;

    device.queue.writeBuffer(
      diskUniformBuffer,
      8,
      new Float32Array([rotationX]),
    );
  });

  const startTime = performance.now();
  let lastFrameTime = 0;
  const targetFPS = 30;
  const frameInterval = 1000 / targetFPS;

  function render(now) {
    requestAnimationFrame(render);

    const delta = now - lastFrameTime;
    if (delta < frameInterval) return;

    lastFrameTime = now - (delta % frameInterval);

    const currentTime = (now - startTime) * 0.001;

    diskData[3] = currentTime;
    device.queue.writeBuffer(
      diskUniformBuffer,
      12,
      new Float32Array([currentTime]),
    );

    const commandEncoder = device.createCommandEncoder();

    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(800 / 16), Math.ceil(800 / 16));
    computePass.end();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(6);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
  }

  requestAnimationFrame(render);
}

init();
