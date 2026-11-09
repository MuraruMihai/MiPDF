/// <reference types="vite/client" />
declare module '*?worker&inline' {
  const W: { new (): Worker };
  export default W;
}
