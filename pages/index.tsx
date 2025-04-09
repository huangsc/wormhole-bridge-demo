import React from 'react';
import dynamic from 'next/dynamic';

// 动态导入组件以避免 SSR 时的 window 对象问题
const BridgeComponent = dynamic(
  () => import('../components/BridgeComponent'),
  { ssr: false }
);

const HomePage = () => {
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <BridgeComponent />
      </div>
    </div>
  );
};

export default HomePage;
