export default function Home() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <style>{`
        @keyframes spinAndBounce {
          0% {
            transform: rotate(0deg) scale(1);
          }
          50% {
            transform: rotate(180deg) scale(2);
          }
          100% {
            transform: rotate(360deg) scale(1);
          }
        }
        .spinning-bouncing-logo {
          animation: spinAndBounce 1.2s linear infinite;
        }
      `}</style>

      <img 
        src="/signature.jpg" 
        alt="Logo" 
        className="spinning-bouncing-logo"
        style={{ width: "150px", height: "auto" }}
      />
    </main>
  );
}

export function meta() {
  return [
    { title: "Donghoon Yi" },
    { name: "description", content: "Welcome to my website!" },
  ];
}

export const links = () => [
  { rel: "icon", href: "/signature.jpg", type: "image/x-icon" },



];