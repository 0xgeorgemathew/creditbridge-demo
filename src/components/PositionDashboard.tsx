"use client";

import { useState, useEffect, useCallback } from "react";
import { Position, PositionStats } from "@/types";
import { getPositionDetails, closeLeveragePosition, getLINKPrice } from "@/lib/contract";
import { useAccount } from "wagmi";
import { 
    AlertCircle
} from "lucide-react";

// Helper to calculate position stats with proper decimal handling
const calculateStats = (position: Position, currentLinkPrice: number): PositionStats => {
    // Parse position data with correct decimals
    const collateralLINK = parseFloat(position.collateralLINK) / 1e18; // 18 decimals
    const suppliedLINK = parseFloat(position.suppliedLINK) / 1e18; // 18 decimals
    const borrowedUSDC = parseFloat(position.borrowedUSDC) / 1e6; // 6 decimals
    const entryPrice = parseFloat(position.entryPrice) / 1e8; // 8 decimals
    
    // Calculate values at entry and current prices
    const initialCollateralUSD = collateralLINK * entryPrice;
    const currentCollateralUSD = collateralLINK * currentLinkPrice;
    const totalExposureUSD = suppliedLINK * currentLinkPrice;
    const initialTotalExposureUSD = suppliedLINK * entryPrice;
    
    // Correct P&L calculation for leverage positions
    // P&L = (current_total_value - initial_total_value) - borrowed_amount_change
    // Since borrowed amount stays constant, P&L = current_total_value - initial_total_value
    const pnl = totalExposureUSD - initialTotalExposureUSD;
    
    // Calculate health factor based on 85% liquidation threshold
    const liquidationThreshold = 0.85;
    const healthFactor = totalExposureUSD > 0 ? (totalExposureUSD * liquidationThreshold) / borrowedUSDC : 0;
    
    // Liquidation price calculation
    const liquidationPrice = suppliedLINK > 0 ? borrowedUSDC / (suppliedLINK * liquidationThreshold) : 0;

    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = position.preAuthExpiryTime - now;
    
    // Calculate current LTV (Loan-to-Value ratio)
    const currentLTV = totalExposureUSD > 0 ? (borrowedUSDC / totalExposureUSD) * 100 : 0;

    return {
        collateralUSD: currentCollateralUSD,
        currentCollateralUSD,
        totalExposureLINK: suppliedLINK,
        totalExposureUSD,
        unrealizedPnL: pnl,
        unrealizedPnLPercent: initialCollateralUSD > 0 ? (pnl / initialCollateralUSD) * 100 : 0,
        liquidationPrice,
        healthFactor,
        timeRemaining,
        currentLTV,
        isAtRisk: healthFactor < 1.1 // At risk if health factor < 1.1
    };
};

export default function PositionDashboard() {
    const { address } = useAccount();
    const [position, setPosition] = useState<Position | null>(null);
    const [stats, setStats] = useState<PositionStats | null>(null);
    const [linkPrice, setLinkPrice] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isClosing, setIsClosing] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(0);

    const fetchData = useCallback(async () => {
        if (!address) return;
        try {
            const [pos, priceString] = await Promise.all([
                getPositionDetails(address),
                getLINKPrice(),
            ]);
            const price = parseFloat(priceString) / 1e8; // Convert from 8 decimals
            setPosition(pos);
            setLinkPrice(price);
            if (pos && pos.isActive) {
                const calculatedStats = calculateStats(pos, price);
                setStats(calculatedStats);
                setTimeRemaining(calculatedStats.timeRemaining);
            } else {
                // Position is not active (closed), clear everything
                setPosition(null);
                setStats(null);
                setTimeRemaining(0);
            }
            setError(null); // Clear any previous errors on successful fetch
        } catch (err: unknown) {
            // Only set error if we don't already have a closed position
            if (position === null || (position && position.isActive)) {
                setError(err instanceof Error ? err.message : "An unknown error occurred.");
            }
        } finally {
            setLoading(false);
        }
    }, [address, position]);

    // Initial data fetch
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Real-time countdown timer
    useEffect(() => {
        if (!stats || timeRemaining <= 0) return;

        const timer = setInterval(() => {
            setTimeRemaining(prev => {
                const newTime = prev - 1;
                return newTime > 0 ? newTime : 0;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [stats, timeRemaining]);

    const handleClosePosition = async () => {
        setIsClosing(true);
        setError(null);
        try {
            await closeLeveragePosition();
            setPosition(null); // Optimistically clear position
            setStats(null); // Clear stats to prevent calculations on null position
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "An unknown error occurred.");
        } finally {
            setIsClosing(false);
        }
    };

    if (loading) {
        return (
            <div className="glassmorphism rounded-2xl p-12 border border-white/20 min-h-[800px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
                    <span className="text-white text-lg">Loading position data...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return <div className="glassmorphism p-8 text-red-400"><AlertCircle className="inline mr-2"/>Error: {error}</div>;
    }

    if (!position) {
        return (
            <div className="glassmorphism rounded-2xl p-12 text-center border border-white/20 min-h-[800px] flex items-center justify-center">
                <div>
                    <h3 className="text-2xl font-bold text-white mb-3">No Active Position</h3>
                    <p className="text-gray-400">Open a position to see your dashboard.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="glassmorphism rounded-2xl p-12 border border-white/20 min-h-[800px]">
            <h2 className="text-4xl font-bold text-white mb-12 gradient-text">Position Dashboard</h2>
            
            {stats && (
                <div className="grid md:grid-cols-4 gap-6 mb-8">
                    <div className={`p-4 rounded-xl ${stats.unrealizedPnL >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                        <p className="text-sm text-gray-300">Unrealized P&L</p>
                        <p className={`text-2xl font-bold ${stats.unrealizedPnL >= 0 ? 'text-green-300' : 'text-red-300'}`}>${stats.unrealizedPnL.toFixed(2)}</p>
                        <p className={`text-sm ${stats.unrealizedPnLPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>{stats.unrealizedPnLPercent.toFixed(2)}%</p>
                    </div>
                    <div className="p-4 rounded-xl bg-blue-500/10">
                        <p className="text-sm text-gray-300">Total Exposure</p>
                        <p className="text-2xl font-bold text-blue-300">${stats.totalExposureUSD.toFixed(2)}</p>
                        <p className="text-sm text-blue-400">{stats.totalExposureLINK.toFixed(4)} LINK</p>
                    </div>
                    <div className="p-4 rounded-xl bg-purple-500/10">
                        <p className="text-sm text-gray-300">Liquidation Price</p>
                        <p className="text-2xl font-bold text-purple-300">${stats.liquidationPrice.toFixed(2)}</p>
                        <p className="text-sm text-purple-400">Current: ${linkPrice.toFixed(2)}</p>
                    </div>
                    <div className={`p-4 rounded-xl ${stats.currentLTV > 80 ? 'bg-red-500/10' : stats.currentLTV > 60 ? 'bg-amber-500/10' : 'bg-green-500/10'}`}>
                        <p className="text-sm text-gray-300">Current LTV</p>
                        <p className={`text-2xl font-bold ${stats.currentLTV > 80 ? 'text-red-300' : stats.currentLTV > 60 ? 'text-amber-300' : 'text-green-300'}`}>{stats.currentLTV.toFixed(1)}%</p>
                        <p className="text-sm text-gray-400">Liquidation at 85%</p>
                    </div>
                </div>
            )}

            <div className="mt-8">
                <button 
                    onClick={handleClosePosition}
                    disabled={isClosing}
                    className="w-full btn-gradient-red text-white py-5 px-8 rounded-xl font-bold text-xl disabled:opacity-50 transition-all transform hover:scale-105 flex items-center justify-center gap-3"
                >
                    {isClosing ? (
                        <>
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                            Closing Position...
                        </>
                    ) : (
                        'Close Position'
                    )}
                </button>
            </div>
        </div>
    );
}