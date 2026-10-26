/**
 * Declaracion ambiental para dependencias de MODULOS instaladas dinamicamente
 * (ref-counting). No estan presentes al compilar el core, pero los modulos las
 * importan con import() en runtime. Declaramos el modulo como opaco para que
 * tsc no falle; el acceso real va casteado en smb.ts.
 */
declare module "@marsaud/smb2";
