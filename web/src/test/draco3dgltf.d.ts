// draco3dgltf ships no types; labModel.test.ts only hands the decoder to gltf-transform.
declare module 'draco3dgltf' {
  const draco3d: {
    createDecoderModule(): Promise<unknown>;
  };
  export default draco3d;
}
