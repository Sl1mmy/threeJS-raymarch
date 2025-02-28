const glsl = (x) => x[0]; // Dummy function to enable syntax highlighting for glsl code

export const vertCode = glsl`
out vec2 vUv; // to send to fragment shader

void main() {
    // Compute view direction in world space
    vec4 worldPos = modelViewMatrix * vec4(position, 1.0);
    vec3 viewDir = normalize(-worldPos.xyz);

    // Output vertex position
    gl_Position = projectionMatrix * worldPos;

    vUv = uv;
}`

export const fragCode = glsl`
precision mediump float;

// From vertex shader
in vec2 vUv;

// From CPU
uniform vec3 u_clearColor;

uniform float u_eps;
uniform float u_maxDis;
uniform int u_maxSteps;

uniform vec3 u_camPos;
uniform mat4 u_camToWorldMat;
uniform mat4 u_camInvProjMat;

uniform vec3 u_lightDir;
uniform vec3 u_lightColor;

uniform float u_diffIntensity;
uniform float u_specIntensity;
uniform float u_ambientIntensity;
uniform float u_shininess;

uniform float u_time;

// -------------------------------------------------------------------- UTILS

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

vec3 rotateByQuaternion(vec3 v, vec4 quat) {
  // Quaternion multiplication: q * v * conjugate(q)
  vec3 uv = cross(quat.xyz, v);
  vec3 uuv = cross(quat.xyz, uv);
  return v + 2.0 * (quat.w * uv + uuv);
}

float sdSphere( vec3 p, float s, vec4 quat )
{
  p = rotateByQuaternion(p, quat);
  return length(p) - s;
}

float sdBox(vec3 p, vec3 b, vec4 quat )
{
  p = rotateByQuaternion(p, quat);
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox( vec3 p, vec3 b, float r, vec4 quat )
{
  p = rotateByQuaternion(p, quat);
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdTorus( vec3 p, vec2 t, vec4 quat )
{
  p = rotateByQuaternion(p, quat);
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float opUnion( float d1, float d2 ) { return min(d1,d2); }
float opSubtraction( float d1, float d2 ) { return max(-d1,d2); }
float opIntersection( float d1, float d2 ) { return max(d1,d2); }
float opXor(float d1, float d2 ) { return max(min(d1,d2),-max(d1,d2)); }

vec3 twist( vec3 pos, float amount )
{
    vec3 p = normalize( pos );
    float c = cos(amount * p.y);
    float s = sin(amount * p.y);
    mat2  m = mat2(c,-s,s,c);
    vec3  q = vec3(m*pos.xz,pos.y);
    return q;
}
vec3 repeat( vec3 p, vec3 r )
{
    return mod( p, r ) - .5 * r;
}

//http://www.pouet.net/topic.php?post=367360
const vec3 pa = vec3(1., 57., 21.);
const vec4 pb = vec4(0., 57., 21., 78.);
float perlin(vec3 p) {
	vec3 i = floor(p);
	vec4 a = dot( i, pa ) + pb;
	vec3 f = cos((p-i)*acos(-1.))*(-.5)+.5;
	a = mix(sin(cos(a)*a),sin(cos(1.+a)*(1.+a)), f.x);
	a.xy = mix(a.xz, a.yw, f.y);
	return mix(a.x, a.y, f.z);
}

// -------------------------------------------------------------------- RAYMARCHING

float scene(vec3 p) {
  // Rotation quaternion
  vec4 quat = normalize(vec4(1.0, sin(u_time) * 0.1, 0.0, u_time * 0.2)); // Normalized quaternion

  // Apply some noise distortion
  vec3 noise = p * 0.25;
  float pnoise = 1.0 + perlin(noise); // Adding some noise for variation

  // Apply rotation to the position using quaternion
  vec3 rotatedP = rotateByQuaternion(p, quat);

  // Define the shapes with rotation and noise
  float roundBox = sdRoundBox(rotatedP, vec3(2.0, 2.0, 2.0), 0.5, quat);
  float sre = sdSphere(rotatedP, 2.5, quat);
  float sphere = sdSphere(rotatedP, 1., quat) + perlin(rotatedP + u_time) * 0.25;

  // Return the final distance, combining shapes and noise with smooth minimum
  return smin(sphere, opSubtraction(sre, roundBox), pnoise);
}



float rayMarch(vec3 ro, vec3 rd)
{
    float d = 0.; // total distance travelled
    float cd; // current scene distance
    vec3 p; // current position of ray

    for (int i = 0; i < u_maxSteps; ++i) { // main loop
        p = ro + d * rd; // calculate new position
        cd = scene(p); // get scene distance
        
        // if we have hit anything or our distance is too big, break loop
        if (cd < u_eps || d >= u_maxDis) break;

        // otherwise, add new scene distance to total distance
        d += cd;
    }

    return d; // finally, return scene distance
}

vec3 sceneCol(vec3 p) {
  float sphere1Dis = distance(p, vec3(cos(u_time), sin(u_time), 0)) - 1.;
  float sphere2Dis = distance(p, vec3(sin(u_time), cos(u_time), 0)) - 0.75;

  float k = 0.5; // The same parameter used in the smin function in "scene"
  float h = clamp(0.5 + 0.5 * (sphere2Dis - sphere1Dis) / k, 0.0, 1.0);

  vec3 color1 = vec3(1, 0, 0); // Red
  vec3 color2 = vec3(0, 0, 1); // Blue

  return mix(color1, color2, h);
}

vec3 normal(vec3 p) // from https://iquilezles.org/articles/normalsSDF/
{
 vec3 n = vec3(0, 0, 0);
 vec3 e;
 for(int i = 0; i < 4; i++) {
  e = 0.5773 * (2.0 * vec3((((i + 3) >> 1) & 1), ((i >> 1) & 1), (i & 1)) - 1.0);
  n += e * scene(p + e * u_eps);
 }
 return normalize(n);
}

void main() {
    // Get UV from vertex shader
    vec2 uv = vUv.xy;

    // Get ray origin and direction from camera uniforms
    vec3 ro = u_camPos;
    vec3 rd = (u_camInvProjMat * vec4(uv*2.-1., 0, 1)).xyz;
    rd = (u_camToWorldMat * vec4(rd, 0)).xyz;
    rd = normalize(rd);
    
    // Ray marching and find total distance travelled
    float disTravelled = rayMarch(ro, rd); // use normalized ray

    if (disTravelled >= u_maxDis) { // if ray doesn't hit anything
        gl_FragColor = vec4(u_clearColor,1);
    } else { // if ray hits something
        // Find the hit position
        vec3 hp = ro + disTravelled * rd;
    
        // Get normal of hit point
        vec3 n = normal(hp);
        
        // Calculate Diffuse model
        float dotNL = dot(n, u_lightDir);
        float diff = max(dotNL, 0.0) * u_diffIntensity;
        float spec = pow(diff, u_shininess) * u_specIntensity;
        float ambient = u_ambientIntensity;
        
        vec3 color = u_lightColor * (sceneCol(hp) * (spec + ambient + diff));
        gl_FragColor = vec4(color,1); // color output
    }
}
`