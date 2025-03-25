export function Announcement() {
  return (
    <div className="fixed top-[80px] left-0 w-full h-full pointer-events-none">
      <div className="max-w-[1920px] h-full mx-auto relative">
        {/* Left Advertisement */}
        <a 
          href="https://i.pinimg.com/736x/c7/08/fe/c708fef4679870b20d1fa21ccb66591d.jpg" 
          target="_blank" 
          rel="noopener noreferrer"
          className="fixed left-0 top-[80px] w-[160px] h-[calc(100vh-80px)] pointer-events-auto"
        >
          <div className="w-full h-full bg-red-500 flex items-center justify-center">
            <svg viewBox="0 0 100 800" className="w-full h-full">
              <path
                d="M 50 0 Q 60 200, 50 400 Q 40 600, 50 800"
                stroke="white"
                strokeWidth="3"
                fill="none"
                className="animate-pulse"
              />
            </svg>
          </div>
        </a>

        {/* Right Advertisement */}
        <a 
          href="https://i.pinimg.com/736x/c7/08/fe/c708fef4679870b20d1fa21ccb66591d.jpg" 
          target="_blank" 
          rel="noopener noreferrer"
          className="fixed right-0 top-[80px] w-[160px] h-[calc(100vh-80px)] pointer-events-auto"
        >
          <div className="w-full h-full bg-red-500 flex items-center justify-center">
            <svg viewBox="0 0 100 800" className="w-full h-full">
              <path
                d="M 50 0 Q 60 200, 50 400 Q 40 600, 50 800"
                stroke="white"
                strokeWidth="3"
                fill="none"
                className="animate-pulse"
              />
            </svg>
          </div>
        </a>
      </div>
    </div>
  );
} 