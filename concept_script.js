const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");


// ============================================================
// Canvas
// ============================================================

const width = 800;
const height = 600;

canvas.width = width;
canvas.height = height;


// ============================================================
// 강착원반
// ============================================================

const disk = {
    innerRadius: 6,
    outerRadius: 9,

    rotationX: -84 * Math.PI / 180
};


function isInAccretionDisk(x, y, z) {

    const cos = Math.cos(disk.rotationX);
    const sin = Math.sin(disk.rotationX);

    const localY = y * cos + z * sin;
    const localZ = -y * sin + z * cos;

    const epsilon = 0.000001;

    if (Math.abs(localZ) > epsilon) {
        return false;
    }

    const r = Math.sqrt(
        x * x +
        localY * localY
    );

    return (
        r >= disk.innerRadius &&
        r <= disk.outerRadius
    );
}


// ============================================================
// 카메라
// ============================================================

const camera = {
    x: 0,
    y: 0,
    z: -15
};


const imagePlane = {
    z: -5
};


const imagePlaneWidth = 24;
const imagePlaneHeight = 18;


// ============================================================
// Ray 생성
// ============================================================

function createRay(pixelX, pixelY) {

    const normalizedX =
        pixelX / width - 0.5;

    const normalizedY =
        pixelY / height - 0.5;


    const targetX =
        normalizedX * imagePlaneWidth;

    const targetY =
        normalizedY * imagePlaneHeight;

    const targetZ =
        imagePlane.z;


    const dx =
        targetX - camera.x;

    const dy =
        targetY - camera.y;

    const dz =
        targetZ - camera.z;


    const length =
        Math.sqrt(
            dx * dx +
            dy * dy +
            dz * dz
        );


    return {
        origin: {
            x: camera.x,
            y: camera.y,
            z: camera.z
        },

        direction: {
            x: dx / length,
            y: dy / length,
            z: dz / length
        }
    };
}


// ============================================================
// Ray 추적
// ============================================================
//
// 레이를 조금씩 진행시키면서
// 매번 중력을 계산하고 방향을 수정한다.
// ============================================================

function traceRay(ray) {

    // --------------------------------------------------------
    // 블랙홀
    // --------------------------------------------------------

    const blackHole = {
        x: 0,
        y: 0,
        z: 0,

        // 임의의 중력 세기
        mass: 3
    };


    // --------------------------------------------------------
    // 한 번에 이동할 거리
    // --------------------------------------------------------

    const step = 0.1;


    // --------------------------------------------------------
    // 최대 반복 횟수
    // --------------------------------------------------------

    const maxSteps = 1500;


    // --------------------------------------------------------
    // 레이의 현재 위치
    // --------------------------------------------------------

    let x = ray.origin.x;
    let y = ray.origin.y;
    let z = ray.origin.z;


    // --------------------------------------------------------
    // 레이의 현재 진행 방향
    // --------------------------------------------------------

    let dx = ray.direction.x;
    let dy = ray.direction.y;
    let dz = ray.direction.z;


    // --------------------------------------------------------
    // 반복하면서 레이를 진행시킨다.
    // --------------------------------------------------------

    for (let i = 0; i < maxSteps; i++) {

        // ====================================================
        // 1. 블랙홀과 현재 위치 사이의 벡터
        // ====================================================

        const toBlackHoleX =
            blackHole.x - x;

        const toBlackHoleY =
            blackHole.y - y;

        const toBlackHoleZ =
            blackHole.z - z;


        // ====================================================
        // 2. 블랙홀까지의 거리
        // ====================================================

        const distance =
            Math.sqrt(
                toBlackHoleX * toBlackHoleX +
                toBlackHoleY * toBlackHoleY +
                toBlackHoleZ * toBlackHoleZ
            );


        // ====================================================
        // 3. 블랙홀에 너무 가까워지면 종료
        // ====================================================

        if (distance < 2) {
            return null;
        }


        // ====================================================
        // 4. 블랙홀 방향 벡터를 정규화
        // ====================================================

        const gravityX =
            toBlackHoleX / distance;

        const gravityY =
            toBlackHoleY / distance;

        const gravityZ =
            toBlackHoleZ / distance;


        // ====================================================
        // 5. 중력의 세기
        //
        // 단순화된 뉴턴 중력 모델
        //
        // gravity ∝ mass / distance²
        // ====================================================

        const gravity =
            blackHole.mass /
            (distance * distance);


        // ====================================================
        // 6. 중력에 의해 방향 벡터를 조금 변경
        // ====================================================

        dx += gravityX * gravity * step;
        dy += gravityY * gravity * step;
        dz += gravityZ * gravity * step;


        // ====================================================
        // 7. 방향 벡터 정규화
        //
        // 방향의 크기는 1로 유지한다.
        // ====================================================

        const directionLength =
            Math.sqrt(
                dx * dx +
                dy * dy +
                dz * dz
            );

        dx /= directionLength;
        dy /= directionLength;
        dz /= directionLength;


        // ====================================================
        // 8. 현재 위치에서 조금 이동
        // ====================================================

        const previousX = x;
        const previousY = y;
        const previousZ = z;


        x += dx * step;
        y += dy * step;
        z += dz * step;


        // ====================================================
        // 9. 이번 이동 구간에서 강착원반과 만났는지 확인
        // ====================================================

        const hit =
            intersectDiskSegment(
                previousX,
                previousY,
                previousZ,

                x,
                y,
                z
            );


        if (hit) {
            return hit;
        }


        // ====================================================
        // 10. 너무 멀리 나가면 탈출한 것으로 처리
        // ====================================================

        if (
            Math.abs(x) > 30 ||
            Math.abs(y) > 30 ||
            Math.abs(z) > 30
        ) {
            return null;
        }
    }


    return null;
}


// ============================================================
// Ray의 한 스텝과 강착원반의 교차
// ============================================================

function intersectDiskSegment(
    x1, y1, z1,
    x2, y2, z2
) {

    const cos = Math.cos(disk.rotationX);
    const sin = Math.sin(disk.rotationX);


    // --------------------------------------------------------
    // 두 점을 원반의 로컬 좌표계로 변환
    // --------------------------------------------------------

    const localZ1 =
        -y1 * sin +
        z1 * cos;

    const localZ2 =
        -y2 * sin +
        z2 * cos;


    // --------------------------------------------------------
    // 두 점이 원반 평면의 서로 다른 쪽에 있는지 확인
    // --------------------------------------------------------

    if (
        localZ1 * localZ2 > 0
    ) {
        return null;
    }


    // --------------------------------------------------------
    // 선분이 원반 평면을 통과하는 위치
    // --------------------------------------------------------

    const denominator =
        localZ1 - localZ2;

    if (Math.abs(denominator) < 0.000001) {
        return null;
    }


    const t =
        localZ1 / denominator;


    if (t < 0 || t > 1) {
        return null;
    }


    // --------------------------------------------------------
    // 교차점
    // --------------------------------------------------------

    const hitX =
        x1 + (x2 - x1) * t;

    const hitY =
        y1 + (y2 - y1) * t;

    const hitZ =
        z1 + (z2 - z1) * t;


    // --------------------------------------------------------
    // 원반 내부인지 확인
    // --------------------------------------------------------

    if (
        isInAccretionDisk(
            hitX,
            hitY,
            hitZ
        )
    ) {
        return {
            x: hitX,
            y: hitY,
            z: hitZ
        };
    }


    return null;
}


// ============================================================
// 렌더링
// ============================================================

const image =
    ctx.createImageData(
        width,
        height
    );


for (
    let pixelY = 0;
    pixelY < height;
    pixelY++
) {

    for (
        let pixelX = 0;
        pixelX < width;
        pixelX++
    ) {

        const index =
            (pixelY * width + pixelX) * 4;


        // ----------------------------------------------------
        // 1. 픽셀에서 Ray 생성
        // ----------------------------------------------------

        const ray =
            createRay(
                pixelX,
                pixelY
            );


        // ----------------------------------------------------
        // 2. Ray를 계속 진행
        // ----------------------------------------------------

        const hit =
            traceRay(ray);


        let r = 0;
        let g = 0;
        let b = 0;


        // ----------------------------------------------------
        // 3. 강착원반에 맞았다면 색을 표시
        // ----------------------------------------------------

        if (hit) {
            r = 255;
            g = 120;
            b = 20;
        }


        // ----------------------------------------------------
        // 4. 픽셀에 기록
        // ----------------------------------------------------

        image.data[index] = r;
        image.data[index + 1] = g;
        image.data[index + 2] = b;
        image.data[index + 3] = 255;
    }
}


ctx.putImageData(image, 0, 0);
