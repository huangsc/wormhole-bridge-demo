import React, { useState } from 'react';
import { ethers } from 'ethers';
import { MetaMaskInpageProvider } from "@metamask/providers";

// NTT Manager ABI
const NTT_MANAGER_ABI = [
  {
    "inputs": [
      {"type": "uint256", "name": "amount"},
      {"type": "uint16", "name": "recipientChain"},
      {"type": "bytes32", "name": "recipient"}
    ],
    "name": "sendTokens",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "address", "name": "token"}, 
      {"type": "uint256", "name": "amount"}, 
      {"type": "uint16", "name": "recipientChain"}, 
      {"type": "bytes32", "name": "recipient"}
    ],
    "name": "transferTokensWithRelay",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "address", "name": "token"}, 
      {"type": "uint256", "name": "amount"}, 
      {"type": "uint16", "name": "recipientChain"}, 
      {"type": "bytes32", "name": "recipient"}
    ],
    "name": "transferTokens",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "initialized",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "tokenDecimals",
    "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// USDC ABI
const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

// 支持的链配置
const SUPPORTED_CHAINS = {
  "Arbitrum Sepolia": {
    chainId: 421614,
    wormholeChainId: 23, // Arbitrum 在 Wormhole 中的链 ID
    name: "Arbitrum Sepolia",
    nttManager: "0x2D42B901dAf957F3d1949a53c7Eb37a8111AEbB8", // Arbitrum Sepolia 上的 NTT Manager 地址
    usdcAddress: "0x3784Ce665CA1AE8f26ae96589b917f8081E72fe7", // Arbitrum Sepolia USDC
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    nativeCurrency: {
      name: "ETH",
      symbol: "ETH",
      decimals: 18
    }
  },
  "BSC Testnet": {
    chainId: 97,
    wormholeChainId: 4, // BSC 在 Wormhole 中的链 ID
    name: "BSC Testnet",
    nttManager: "0x8290988FaBBCFF19737aa72d79680e659207368e", // BSC 测试网上的 NTT Manager 地址
    usdcAddress: "0x6B4d90B36Fd734863d8937140546251db069839b", // BSC Testnet USDC
    rpc: "https://bsc-testnet-rpc.publicnode.com",
    explorer: "https://testnet.bscscan.com",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18
    }
  }
} as const;

declare global {
  interface Window {
    ethereum?: MetaMaskInpageProvider;
  }
}

// 添加 RPC 配置
const RPC_CONFIG = {
  retry: 3,
  timeout: 30000,
  gasBuffer: 1.2  // 20% 的 gas 缓冲
};

// 添加重试函数
const retryOperation = async (operation: () => Promise<any>, retries = RPC_CONFIG.retry) => {
  try {
    return await operation();
  } catch (error) {
    if (retries > 0) {
      console.log(`操作失败，剩余重试次数: ${retries - 1}`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待 2 秒
      return retryOperation(operation, retries - 1);
    }
    throw error;
  }
};

const BridgeComponent = () => {
  const [sourceChain, setSourceChain] = useState("");
  const [targetChain, setTargetChain] = useState("");
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState<ethers.Signer | null>(null);
  const [loading, setLoading] = useState(false);
  const [transferStatus, setTransferStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // 连接 MetaMask 钱包
  const connectWallet = async () => {
    try {
      if (typeof window.ethereum !== 'undefined') {
        const provider = new ethers.providers.Web3Provider(window.ethereum as any);
        await provider.send('eth_requestAccounts', []);
        const signer = provider.getSigner();
        setWallet(signer);

        // 获取当前网络信息
        const network = await provider.getNetwork();
        console.log('Current network after connection:', network);

        // 监听网络变化
        window.ethereum.on('chainChanged', (chainId) => {
          console.log('Network changed to:', chainId);
          window.location.reload();
        });
      } else {
        alert('请安装 MetaMask!');
      }
    } catch (error) {
      console.error('连接钱包错误:', error);
    }
  };

  // 切换网络
  const switchNetwork = async (chainId: number, chainConfig: typeof SUPPORTED_CHAINS[keyof typeof SUPPORTED_CHAINS]) => {
    try {
      // 将 chainId 转换为十六进制，但不添加前导零
      const hexChainId = `0x${chainId.toString(16)}`;
      console.log('Switching to network:', { chainId, hexChainId, chainConfig });
      
      await window.ethereum?.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (error: any) {
      console.log('Switch network error:', error);
      if (error.code === 4902) {
        // 如果网络不存在，添加网络
        try {
          const hexChainId = `0x${chainId.toString(16)}`;
          await window.ethereum?.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: hexChainId,
                chainName: chainConfig.name,
                nativeCurrency: chainConfig.nativeCurrency,
                rpcUrls: [chainConfig.rpc],
                blockExplorerUrls: [chainConfig.explorer],
              },
            ],
          });
        } catch (addError) {
          console.error('添加网络错误:', addError);
          alert('请手动在 MetaMask 中添加目标网络');
        }
      }
      throw error;
    }
  };

  // 执行跨链转账
  const performBridgeTransfer = async () => {
    if (!sourceChain || !targetChain || !amount || !wallet) {
      setTransferStatus("请选择源链、目标链、金额并连接钱包");
      return;
    }

    try {
      setTransferStatus("发起跨链转账...");

      // 获取源链和目标链配置
      const srcChainConfig = SUPPORTED_CHAINS[sourceChain as keyof typeof SUPPORTED_CHAINS];
      const dstChainConfig = SUPPORTED_CHAINS[targetChain as keyof typeof SUPPORTED_CHAINS];
      console.log('Chain configs:', { srcChainConfig, dstChainConfig });

      if (!wallet.provider) {
        throw new Error("钱包 provider 未找到");
      }

      // 检查钱包是否连接到正确的网络
      const network = await wallet.provider.getNetwork();
      console.log('Current network:', network);

      if (network.chainId !== srcChainConfig.chainId) {
        await switchNetwork(srcChainConfig.chainId, srcChainConfig);
      }

      // 获取当前gas价格
      const gasPrice = await wallet.provider.getGasPrice();
      console.log('Current gas price:', ethers.utils.formatUnits(gasPrice, 'gwei'), 'gwei');

      // 获取钱包地址
      const walletAddress = await wallet.getAddress();

      // 检查ETH余额
      const ethBalance = await wallet.provider.getBalance(walletAddress);
      console.log('ETH balance:', ethers.utils.formatEther(ethBalance));

      if (ethBalance.lt(ethers.utils.parseEther('0.005'))) {
        throw new Error(`ETH 余额不足，至少需要 0.005 ${srcChainConfig.nativeCurrency.name}。当前余额: ${ethers.utils.formatEther(ethBalance)}`);
      }

      // 检查合约代码
      const nttManagerCode = await wallet.provider.getCode(srcChainConfig.nttManager);
      console.log('Contract code length:', nttManagerCode.length);

      if (nttManagerCode.length <= 2) {
        throw new Error(`NTT Manager 合约地址无效: ${srcChainConfig.nttManager}`);
      }

      // 创建合约实例
      const nttManager = new ethers.Contract(srcChainConfig.nttManager, NTT_MANAGER_ABI, wallet);
      
      // 检查合约是否已初始化
      try {
        const initialized = await nttManager.initialized();
        console.log('合约初始化状态:', initialized);
        if (!initialized) {
          throw new Error('NTT Manager合约尚未初始化');
        }
      } catch (error) {
        console.warn('无法检查合约初始化状态，继续执行:', error);
      }

      // 创建USDC合约实例
      const usdcAbi = [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function allowance(address, address) view returns (uint256)",
        "function approve(address, uint256) returns (boolean)"
      ];
      
      const usdcContract = new ethers.Contract(srcChainConfig.usdcAddress, usdcAbi, wallet);
      
      // 获取USDC代币精度
      const decimals = await usdcContract.decimals();
      console.log('USDC decimals:', decimals);
      
      // 获取合约代币精度 (可能与USDC不同)
      const tokenDecimals = decimals;
      console.log('Contract token decimals:', tokenDecimals);
      
      // 将输入金额转换为wei单位
      const amountWei = ethers.utils.parseUnits(amount, tokenDecimals);
      console.log('Transfer amount:', ethers.utils.formatUnits(amountWei, tokenDecimals));
      
      // 检查USDC余额
      const usdcBalance = await usdcContract.balanceOf(walletAddress);
      console.log('USDC balance:', ethers.utils.formatUnits(usdcBalance, tokenDecimals));
      
      if (usdcBalance.lt(amountWei)) {
        throw new Error(`USDC 余额不足。当前余额: ${ethers.utils.formatUnits(usdcBalance, tokenDecimals)} USDC`);
      }
      
      // 检查USDC是否已授权给NTT Manager
      const currentAllowance = await usdcContract.allowance(walletAddress, srcChainConfig.nttManager);
      console.log('Current allowance:', ethers.utils.formatUnits(currentAllowance, tokenDecimals));
      
      if (currentAllowance.lt(amountWei)) {
        setTransferStatus(`授权 USDC 代币给 NTT Manager...`);
        const approveTx = await usdcContract.approve(srcChainConfig.nttManager, amountWei);
        await approveTx.wait();
        console.log('USDC approved');
      }

      // 获取当前地址的类型和格式
      console.log('原始钱包地址:', walletAddress);
      
      // Wormhole接收者地址格式 - 完全匹配成功交易的格式
      // 我们不再使用000000000000000000000000前缀
      // 注意：需要使用钱包在目标链上的地址，这里用相同地址作为示例
      
      // 构造一个随机的bytes32地址作为测试
      // 在实际使用中，这应该是根据跨链协议要求生成的
      // 这里使用一个简单的哈希函数模拟
      const addressBytes = ethers.utils.arrayify(ethers.utils.id(walletAddress));
      const bytes32Recipient = ethers.utils.hexlify(addressBytes);
      
      console.log('构造的bytes32接收者地址:', bytes32Recipient);
      
      // 创建目标链Wormhole ID的映射
      const wormholeChainIdMap: Record<string, number> = {
        // Mainnet
        ethereum: 2,    // Ethereum
        bsc: 4,         // BNB Smart Chain
        avalanche: 6,   // Avalanche
        polygon: 5,     // Polygon
        arbitrum: 23,   // Arbitrum
        optimism: 24,   // Optimism
        base: 30,       // Base

        // Testnet - 使用同样的映射，但具体值根据测试网络可能有所不同
        "Ethereum Sepolia": 10002,  // Ethereum Sepolia
        "BSC Testnet": 4,          // BSC Testnet
        "Arbitrum Sepolia": 10003,  // Arbitrum Sepolia
      };

      // 根据目标链名称获取正确的Wormhole链ID
      // 使用目标链名称或默认为当前设置的链ID
      const destinationWormholeChainId = wormholeChainIdMap[dstChainConfig.name] || dstChainConfig.wormholeChainId;
      console.log(`目标链 ${dstChainConfig.name} 的Wormhole链ID: ${destinationWormholeChainId}`);

      // 发送交易
      const transferTx = await retryOperation(async () => {
        // 手动构造完全匹配的交易数据
        const manualCallData = '0xb293f97f' + 
          // 去掉0x前缀的amountWei，补齐到64位
          amountWei.toHexString().replace(/^0x/, '').padStart(64, '0') +
          // 使用正确的Wormhole目标链ID，补齐到64位
          destinationWormholeChainId.toString(16).padStart(64, '0') +
          // 接收者地址 - 使用bytes32格式，去掉0x前缀
          bytes32Recipient.replace(/^0x/, '') +
          // 退款地址 - 同上
          bytes32Recipient.replace(/^0x/, '') +
          // shouldQueue参数(false)，补齐到64位
          '0'.padStart(64, '0') +
          // bytes参数位置指针，固定为0xc0
          'c0'.padStart(64, '0') +
          // bytes长度，固定为4
          '4'.padStart(64, '0') +
          // bytes内容 - 01000101，后面补0
          '01000101' + '0'.repeat(56);
        
        console.log('手动构造的交易数据:', manualCallData);
        
        return wallet.sendTransaction({
          to: srcChainConfig.nttManager,
          data: manualCallData,
          value: ethers.utils.parseEther("0.005"), // 跨链费用
          gasLimit: 900000                         // gas限制
        });
      });

      console.log('交易已发送，等待确认. Hash:', transferTx.hash);
      setTransferStatus(`交易已发送，等待确认。\n交易哈希: ${transferTx.hash}\n\n可以在区块浏览器查看：${srcChainConfig.explorer}/tx/${transferTx.hash}`);

      // 等待交易确认
      const receipt = await transferTx.wait();
      console.log('交易已确认:', receipt);

      if (receipt.status === 1) {
        setTransferStatus(`跨链转账成功！\n\n交易哈希: ${transferTx.hash}\n\n请在目标链 ${dstChainConfig.name} 查看你的余额。`);
      } else {
        setTransferStatus(`跨链转账失败。\n\n交易哈希: ${transferTx.hash}`);
      }
      console.log("Bridge transfer completed!");

    } catch (error: any) {
      console.error("跨链转账错误:", error);
      setTransferStatus(`错误: ${error.message || "未知错误"}`);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Wormhole 跨链桥 (测试网)</h1>
      
      {!wallet ? (
        <button
          onClick={connectWallet}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          连接钱包
        </button>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block mb-2">源链:</label>
            <select
              value={sourceChain}
              onChange={(e) => setSourceChain(e.target.value)}
              className="border p-2 rounded w-full"
            >
              <option value="">选择链</option>
              {Object.keys(SUPPORTED_CHAINS).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block mb-2">目标链:</label>
            <select
              value={targetChain}
              onChange={(e) => setTargetChain(e.target.value)}
              className="border p-2 rounded w-full"
            >
              <option value="">选择链</option>
              {Object.keys(SUPPORTED_CHAINS).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block mb-2">金额 (USDC):</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="border p-2 rounded w-full"
              placeholder="输入 USDC 金额"
              step="0.000001"
              min="0"
            />
          </div>

          {transferStatus && (
            <div className="bg-blue-100 text-blue-800 p-4 rounded">
              {transferStatus}
            </div>
          )}

          <button
            onClick={performBridgeTransfer}
            disabled={loading}
            className="bg-green-500 text-white px-4 py-2 rounded w-full disabled:bg-gray-400"
          >
            {loading ? '处理中...' : '执行跨链转账'}
          </button>
          
          <div className="text-sm text-gray-500 mt-4">
            注意：
            <ul className="list-disc pl-5 mt-2">
              <li>当前使用的是测试网络</li>
              <li>需要确保钱包中有足够的测试网 ETH 支付 gas 费用</li>
              <li>可以从水龙头获取测试网代币：
                <ul className="list-disc pl-5 mt-1">
                  <li><a href="https://goerlifaucet.com/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Goerli 测试网</a></li>
                  <li><a href="https://testnet.bnbchain.org/faucet-smart" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">BSC 测试网</a></li>
                  <li><a href="https://faucet.polygon.technology/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Mumbai 测试网</a></li>
                  <li><a href="https://faucet.avax.network/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Fuji 测试网</a></li>
                </ul>
              </li>
              <li>跨链转账需要等待5-15分钟完成确认</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default BridgeComponent;
