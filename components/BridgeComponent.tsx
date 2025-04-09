import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { MetaMaskInpageProvider } from "@metamask/providers";

// NTT Manager ABI - 只保留使用的部分
const NTT_MANAGER_ABI = [
  {
    "inputs": [
      {"type": "uint256", "name": "amount"},
      {"type": "uint16", "name": "recipientChain"},
      {"type": "bytes32", "name": "recipient"},
      {"type": "bytes32", "name": "refundAddress"},
      {"type": "bool", "name": "shouldQueue"},
      {"type": "bytes", "name": "transceiverInstructions"}
    ],
    "name": "transfer",
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

// 最小化CCT ABI - 只包含需要的函数
const CCT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (boolean)"
];

// 支持的链配置
const SUPPORTED_CHAINS = {
  "Arbitrum Sepolia": {
    chainId: 421614,
    wormholeChainId: 23, // Arbitrum 在 Wormhole 中的链 ID
    name: "Arbitrum Sepolia",
    nttManager: "0x2D42B901dAf957F3d1949a53c7Eb37a8111AEbB8", // Arbitrum Sepolia 上的 NTT Manager 地址
    cctAddress: "0x3784Ce665CA1AE8f26ae96589b917f8081E72fe7", // Arbitrum Sepolia CCT
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
    cctAddress: "0x6B4d90B36Fd734863d8937140546251db069839b", // BSC Testnet CCT
    rpc: "https://bsc-testnet-rpc.publicnode.com",
    explorer: "https://testnet.bscscan.com",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18
    }
  }
} as const;

// Wormhole链ID映射 - 根据官方文档
const WORMHOLE_CHAIN_ID_MAP: Record<string, number> = {
  "Ethereum": 2,
  "Solana": 1,
  "BNB Smart Chain": 4,
  "BSC Testnet": 4,
  "Avalanche": 6,
  "Polygon": 5,
  "Arbitrum": 23,
  "Arbitrum Sepolia": 10003,
  "Optimism": 24,
  "Base": 30,
  "Ethereum Sepolia": 10002
};

// 跨链传输常量
const CROSS_CHAIN_CONSTANTS = {
  FEE: "0.005", // 跨链费用 (ETH)
  GAS_LIMIT: 900000, // Gas限制
  FUNCTION_SELECTOR: "0xb293f97f", // transfer函数选择器
  TX_RETRY_COUNT: 3, // 重试次数
  TX_TIMEOUT: 30000, // 超时时间(ms)
};

declare global {
  interface Window {
    ethereum?: MetaMaskInpageProvider;
  }
}

// 添加重试函数
const retryOperation = async <T,>(operation: () => Promise<T>, retries = CROSS_CHAIN_CONSTANTS.TX_RETRY_COUNT) => {
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

// 类型定义
type ChainConfig = typeof SUPPORTED_CHAINS[keyof typeof SUPPORTED_CHAINS];
type TransactionStatus = "idle" | "preparing" | "approving" | "transferring" | "confirming" | "success" | "error";

const BridgeComponent = () => {
  const [sourceChain, setSourceChain] = useState<string>("");
  const [targetChain, setTargetChain] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [wallet, setWallet] = useState<ethers.Signer | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [status, setStatus] = useState<TransactionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");
  const [srcChainConfig, setSrcChainConfig] = useState<ChainConfig | null>(null);
  const [dstChainConfig, setDstChainConfig] = useState<ChainConfig | null>(null);

  // 处理源链和目标链变化
  useEffect(() => {
    if (sourceChain) {
      setSrcChainConfig(SUPPORTED_CHAINS[sourceChain as keyof typeof SUPPORTED_CHAINS]);
    } else {
      setSrcChainConfig(null);
    }
  }, [sourceChain]);

  useEffect(() => {
    if (targetChain) {
      setDstChainConfig(SUPPORTED_CHAINS[targetChain as keyof typeof SUPPORTED_CHAINS]);
    } else {
      setDstChainConfig(null);
    }
  }, [targetChain]);

  // 连接 MetaMask 钱包
  const connectWallet = async () => {
    try {
      if (typeof window.ethereum !== 'undefined') {
        const provider = new ethers.providers.Web3Provider(window.ethereum as any);
        await provider.send('eth_requestAccounts', []);
        const signer = provider.getSigner();
        setWallet(signer);
        
        // 获取当前钱包地址
        const address = await signer.getAddress();
        setWalletAddress(address);

        // 获取当前网络信息
        const network = await provider.getNetwork();
        console.log('当前网络:', network);

        // 监听网络变化
        window.ethereum.on('chainChanged', (_chainId) => {
          console.log('网络已切换:', _chainId);
          window.location.reload();
        });

        // 监听账户变化
        window.ethereum.on('accountsChanged', (accounts: any) => {
          console.log('账户已切换:', accounts);
          if (accounts.length === 0) {
            // 用户断开了钱包
            setWallet(null);
            setWalletAddress("");
          } else {
            // 用户切换了账户
            window.location.reload();
          }
        });
      } else {
        alert('请安装 MetaMask!');
      }
    } catch (error) {
      console.error('连接钱包错误:', error);
      setStatusMessage('连接钱包失败，请重试');
    }
  };

  // 切换网络
  const switchNetwork = async (chainId: number, chainConfig: ChainConfig) => {
    if (!window.ethereum) {
      throw new Error("MetaMask未安装");
    }

    try {
      const hexChainId = `0x${chainId.toString(16)}`;
      console.log('切换到网络:', { chainId, hexChainId, chainConfig });
      
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (error: any) {
      console.log('切换网络错误:', error);
      
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
          throw new Error('无法添加网络，请手动在 MetaMask 中添加');
        }
      } else {
        throw error;
      }
    }
  };

  // 准备跨链传输的地址格式
  const prepareRecipientAddress = (address: string): string => {
    // 使用钱包地址的哈希作为bytes32格式的接收地址
    const addressBytes = ethers.utils.arrayify(ethers.utils.id(address));
    return ethers.utils.hexlify(addressBytes);
  };

  // 执行跨链转账
  const performBridgeTransfer = async () => {
    if (!sourceChain || !targetChain || !amount || !wallet || !srcChainConfig || !dstChainConfig) {
      setStatusMessage("请选择源链、目标链、金额并连接钱包");
      return;
    }

    try {
      setStatus("preparing");
      setStatusMessage("准备跨链转账...");
      setTxHash("");

      if (!wallet.provider) {
        throw new Error("钱包 provider 未找到");
      }

      // 检查钱包是否连接到正确的网络
      const network = await wallet.provider.getNetwork();
      console.log('当前网络:', network);

      if (network.chainId !== srcChainConfig.chainId) {
        setStatusMessage(`切换到 ${srcChainConfig.name} 网络...`);
        await switchNetwork(srcChainConfig.chainId, srcChainConfig);
        
        // 网络切换后重新获取provider
        const newProvider = new ethers.providers.Web3Provider(window.ethereum as any);
        const newSigner = newProvider.getSigner();
        setWallet(newSigner);
      }

      // 获取当前gas价格
      const gasPrice = await wallet.provider.getGasPrice();
      console.log('当前gas价格:', ethers.utils.formatUnits(gasPrice, 'gwei'), 'gwei');

      // 获取钱包地址（如果还没有获取）
      const address = walletAddress || await wallet.getAddress();
      if (!walletAddress) {
        setWalletAddress(address);
      }

      // 检查ETH余额
      const ethBalance = await wallet.provider.getBalance(address);
      console.log('ETH余额:', ethers.utils.formatEther(ethBalance));

      const requiredEth = ethers.utils.parseEther(CROSS_CHAIN_CONSTANTS.FEE);
      if (ethBalance.lt(requiredEth)) {
        throw new Error(`${srcChainConfig.nativeCurrency.symbol} 余额不足，至少需要 ${CROSS_CHAIN_CONSTANTS.FEE} ${srcChainConfig.nativeCurrency.symbol}。当前余额: ${ethers.utils.formatEther(ethBalance)}`);
      }

      // 检查合约代码
      const nttManagerCode = await wallet.provider.getCode(srcChainConfig.nttManager);
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

      // 创建CCT合约实例
      const cctContract = new ethers.Contract(srcChainConfig.cctAddress, CCT_ABI, wallet);
      
      // 获取CCT代币精度
      const decimals = await cctContract.decimals();
      console.log('CCT精度:', decimals);
      
      // 将输入金额转换为wei单位
      const amountWei = ethers.utils.parseUnits(amount, decimals);
      console.log('转账金额:', ethers.utils.formatUnits(amountWei, decimals));
      
      // 检查CCT余额
      const cctBalance = await cctContract.balanceOf(address);
      console.log('CCT余额:', ethers.utils.formatUnits(cctBalance, decimals));
      
      if (cctBalance.lt(amountWei)) {
        throw new Error(`CCT 余额不足。当前余额: ${ethers.utils.formatUnits(cctBalance, decimals)} CCT`);
      }
      
      // 检查CCT是否已授权给NTT Manager
      const currentAllowance = await cctContract.allowance(address, srcChainConfig.nttManager);
      console.log('当前授权额度:', ethers.utils.formatUnits(currentAllowance, decimals));
      
      if (currentAllowance.lt(amountWei)) {
        setStatus("approving");
        setStatusMessage(`授权 CCT 代币给 NTT Manager...`);
        
        const approveTx = await cctContract.approve(srcChainConfig.nttManager, amountWei);
        setTxHash(approveTx.hash);
        setStatusMessage(`授权交易已发送。交易哈希: ${approveTx.hash}`);
        
        await approveTx.wait();
        console.log('CCT授权成功');
      }

      // 准备接收者地址
      const bytes32Recipient = prepareRecipientAddress(address);
      console.log('接收者地址 (bytes32):', bytes32Recipient);
      
      // 获取正确的Wormhole链ID
      const destinationWormholeChainId = WORMHOLE_CHAIN_ID_MAP[dstChainConfig.name] || dstChainConfig.wormholeChainId;
      console.log(`目标链 ${dstChainConfig.name} 的Wormhole链ID: ${destinationWormholeChainId}`);

      // 创建NTT Manager合约实例
      const nttManagerContract = new ethers.Contract(srcChainConfig.nttManager, NTT_MANAGER_ABI, wallet);

      // 准备传输指令数据
      const instructionBytes = new Uint8Array([0x01, 0x00, 0x01, 0x01]);
      const transceiverInstructions = ethers.utils.hexlify(instructionBytes);

      // 发送跨链转账交易
      setStatus("transferring");
      setStatusMessage("发送跨链转账交易...");
      
      const transferTx = await retryOperation(async () => {
        // 使用合约接口发送交易，而不是手动构建数据
        return nttManagerContract.transfer(
          amountWei,                      // amount
          destinationWormholeChainId,     // recipientChain
          bytes32Recipient,               // recipient
          bytes32Recipient,               // refundAddress (与接收者相同)
          false,                          // shouldQueue
          transceiverInstructions,        // transceiverInstructions
          {
            value: ethers.utils.parseEther(CROSS_CHAIN_CONSTANTS.FEE),
            gasLimit: CROSS_CHAIN_CONSTANTS.GAS_LIMIT
          }
        );
      });

      setTxHash(transferTx.hash);
      console.log('交易已发送，等待确认. Hash:', transferTx.hash);
      setStatus("confirming");
      setStatusMessage(`交易已发送，等待确认。\n交易哈希: ${transferTx.hash}`);

      // 等待交易确认
      const receipt = await transferTx.wait();
      console.log('交易已确认:', receipt);

      if (receipt.status === 1) {
        setStatus("success");
        setStatusMessage(`跨链转账成功！请在目标链 ${dstChainConfig.name} 查看你的余额。`);
      } else {
        setStatus("error");
        setStatusMessage(`跨链转账失败。请检查交易详情。`);
      }

    } catch (error: any) {
      console.error("跨链转账错误:", error);
      setStatus("error");
      setStatusMessage(`错误: ${error.message || "未知错误"}`);
    }
  };

  // 获取状态类样式
  const getStatusClass = () => {
    switch (status) {
      case "preparing":
      case "approving":
      case "transferring":
      case "confirming":
        return "bg-blue-100 text-blue-800";
      case "success":
        return "bg-green-100 text-green-800";
      case "error":
        return "bg-red-100 text-red-800";
      default:
        return "";
    }
  };

  // 渲染交易状态
  const renderTransactionStatus = () => {
    if (status === "idle") return null;
    
    return (
      <div className={`p-4 rounded ${getStatusClass()}`}>
        <div className="font-bold">{status.charAt(0).toUpperCase() + status.slice(1)}</div>
        <div className="whitespace-pre-line">{statusMessage}</div>
        {txHash && (
          <div className="mt-2">
            <a 
              href={`${srcChainConfig?.explorer}/tx/${txHash}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              在区块浏览器查看交易 ↗
            </a>
          </div>
        )}
      </div>
    );
  };

  // 是否禁用转账按钮
  const isTransferDisabled = !sourceChain || !targetChain || !amount || !wallet || 
    status === "preparing" || status === "approving" || status === "transferring" || status === "confirming";

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">Wormhole 跨链桥 (测试网)</h1>
      
      {!wallet ? (
        <button
          onClick={connectWallet}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded w-full transition"
        >
          连接钱包
        </button>
      ) : (
        <div className="space-y-4">
          <div className="p-3 bg-gray-100 rounded mb-4 text-sm">
            已连接钱包: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </div>
          
          <div>
            <label className="block mb-2 font-medium">源链:</label>
            <select
              value={sourceChain}
              onChange={(e) => setSourceChain(e.target.value)}
              className="border p-2 rounded w-full bg-white"
              disabled={status !== "idle" && status !== "error" && status !== "success"}
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
            <label className="block mb-2 font-medium">目标链:</label>
            <select
              value={targetChain}
              onChange={(e) => setTargetChain(e.target.value)}
              className="border p-2 rounded w-full bg-white"
              disabled={status !== "idle" && status !== "error" && status !== "success"}
            >
              <option value="">选择链</option>
              {Object.keys(SUPPORTED_CHAINS).map((name) => (
                <option key={name} value={name} disabled={name === sourceChain}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block mb-2 font-medium">金额 (CCT):</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="border p-2 rounded w-full"
              placeholder="输入 CCT 金额"
              step="0.000001"
              min="0"
              disabled={status !== "idle" && status !== "error" && status !== "success"}
            />
          </div>

          {renderTransactionStatus()}

          <button
            onClick={performBridgeTransfer}
            disabled={isTransferDisabled}
            className={`px-4 py-2 rounded w-full transition ${
              isTransferDisabled
                ? "bg-gray-400 text-gray-200 cursor-not-allowed"
                : "bg-green-500 hover:bg-green-600 text-white"
            }`}
          >
            {status === "preparing" || status === "approving" || status === "transferring" || status === "confirming"
              ? "处理中..."
              : "执行跨链转账"}
          </button>
          
          <div className="text-sm text-gray-600 mt-4 bg-gray-50 p-3 rounded">
            <h3 className="font-medium mb-2">说明:</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>当前使用的是测试网络</li>
              <li>需要确保钱包中有足够的测试网代币支付 gas 费用</li>
              <li>跨链转账需要支付 {CROSS_CHAIN_CONSTANTS.FEE} ETH 的跨链费用</li>
              <li>跨链转账完成大约需要 5-15 分钟</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default BridgeComponent;
