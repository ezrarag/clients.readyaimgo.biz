import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/firebase/config"
import { collection, query, where, getDocs, addDoc, orderBy } from "firebase/firestore"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")

  if (!clientId) {
    return NextResponse.json({ error: "Client ID required" }, { status: 400 })
  }

  try {
    const transactionsQuery = query(
      collection(db, "transactions"),
      where("clientId", "==", clientId),
      orderBy("timestamp", "desc")
    )
    const snapshot = await getDocs(transactionsQuery)
    const transactions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || doc.data().timestamp,
    }))

    return NextResponse.json(transactions)
  } catch (error: any) {
    console.error("Error fetching transactions:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { clientId, type, amount, description } = await request.json()

    if (!clientId || !type || amount === undefined || !description) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const transactionData = {
      clientId,
      type,
      amount: parseFloat(amount),
      description,
      timestamp: new Date(),
    }

    const docRef = await addDoc(collection(db, "transactions"), transactionData)

    return NextResponse.json({ id: docRef.id, ...transactionData })
  } catch (error: any) {
    console.error("Error creating transaction:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

