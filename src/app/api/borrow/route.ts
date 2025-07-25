import { NextRequest, NextResponse } from "next/server";
import { loanStorage, generateLoanId } from "@/lib/loanStorage";
import { getStripeInstance } from "@/lib/stripe-server";

export async function POST(request: NextRequest) {
  try {
    const {
      amount,
      amountETH,
      ethPrice,
      asset,
      walletAddress,
      preAuthId,
      requiredPreAuth,
      selectedLTV,
      preAuthDurationMinutes,
      customerId,
      paymentMethodId,
      setupIntentId,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      cardLastFour,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      cardBrand,
    } = await request.json();

    // Validate required fields
    if (!amount || !walletAddress) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const loanId = generateLoanId();
    const borrowAmountUSD = parseFloat(amount);
    const borrowAmountETHNum = parseFloat(amountETH);
    const preAuthAmount = requiredPreAuth || Math.ceil(borrowAmountUSD / (selectedLTV / 100));
    // const interestRate = 4.5; // Removed as no longer used in new contract

    // Demo mode - return simplified response
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
      const mockTxHash = "0x" + Math.random().toString(16).substring(2, 66);
      
      const loanData = {
        // Loan interface fields
        id: loanId,
        walletAddress,
        asset: asset || "ETH",
        status: "active" as const,
        createdAt: new Date().toISOString(),
        txHash: mockTxHash,
        // Position interface fields
        collateralLINK: "0", // Mock value for old API
        leverageRatio: 200, // Mock 2x leverage
        borrowedUSDC: borrowAmountUSD.toString(),
        suppliedLINK: "0", // Mock value for old API
        entryPrice: ethPrice.toString(),
        preAuthAmount: preAuthAmount.toString(),
        openTimestamp: Math.floor(Date.now() / 1000),
        preAuthExpiryTime: Math.floor(Date.now() / 1000) + 3600, // 1 hour
        isActive: true,
        preAuthCharged: false,
        stripePaymentIntentId: preAuthId || setupIntentId || `demo_${Date.now()}`,
        stripeCustomerId: customerId || "demo_customer",
        stripePaymentMethodId: paymentMethodId || "demo_payment_method",
      };

      loanStorage.createLoan(loanData);

      return NextResponse.json({
        success: true,
        loanId,
        txHash: mockTxHash,
        amount: borrowAmountUSD,
        amountETH: borrowAmountETHNum,
        contractParams: {
          preAuthAmountUSD: Math.round(preAuthAmount), // Contract expects USD amount in dollars, not cents
          preAuthDurationMinutes: preAuthDurationMinutes || 7 * 24 * 60,
          stripePaymentIntentId: preAuthId || setupIntentId || `demo_${Date.now()}`,
          stripeCustomerId: customerId || "demo_customer",
          stripePaymentMethodId: paymentMethodId || "demo_payment_method"
        }
      });
    }

    // Production mode - simplified Stripe integration
    if (!customerId || !paymentMethodId) {
      return NextResponse.json({ success: false, error: "Missing Stripe data" }, { status: 400 });
    }

    try {
      const stripe = getStripeInstance();
      
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(preAuthAmount * 100),
        currency: "usd",
        customer: customerId,
        payment_method: paymentMethodId,
        capture_method: "manual",
        confirm: true,
        off_session: true,
        description: `CreditShaft loan ${loanId}`,
      });

      if (paymentIntent.status !== "requires_capture") {
        return NextResponse.json({ 
          success: false, 
          error: `Payment failed: ${paymentIntent.status}` 
        }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        requiresContractCall: true,
        loanId,
        contractParams: {
          preAuthAmountUSD: Math.round(preAuthAmount), // Contract expects USD amount in dollars, not cents
          preAuthDurationMinutes: preAuthDurationMinutes || 7 * 24 * 60,
          stripePaymentIntentId: paymentIntent.id,
          stripeCustomerId: customerId,
          stripePaymentMethodId: paymentMethodId
        }
      });

    } catch (stripeError: unknown) {
      const errorMessage = stripeError instanceof Error ? stripeError.message : 'Unknown Stripe error';
      return NextResponse.json({
        success: false,
        error: `Stripe error: ${errorMessage}`,
      }, { status: 400 });
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Borrowing failed';
    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}

