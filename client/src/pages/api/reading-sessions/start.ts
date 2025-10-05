// == IMPORTS & DEPENDENCIES ==
import jwt from 'jsonwebtoken';
import { db } from "@db";
import * as schema from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

// == CONSTANTS ==
const JWT_SECRET = process.env.JWT_SECRET || "adonai_grace_school_secret";

// == TYPE DEFINITIONS ==
interface JWTPayload {
  userId: number;
  role: string;
  username: string;
  iat?: number;
  exp?: number;
}

// == API HANDLER ==
export default async function handler(req: any, res: any) {
  console.log(`🚀 API endpoint /api/reading-sessions/start called`);
  // Avoid logging request bodies which may contain PII
  console.log("📝 Request received for starting reading session");
  
  // == METHOD VALIDATION ==
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // == AUTHENTICATION ==
  let token: string | undefined;
  try {
    token = String(req.headers.authorization || "").split(' ')[1];
  } catch {
    token = undefined;
  }
  if (!token) {
    console.log("❌ No token provided");
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    // == TOKEN VERIFICATION ==
  const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
  // Log only minimal token info to avoid leaking sensitive payload
  console.log("✅ Decoded token: userId=" + decoded.userId + ", role=" + decoded.role);
    
    // == AUTHORIZATION CHECK ==
    if (!decoded || (decoded.role !== 'student' && decoded.role !== 'teacher' && decoded.role !== 'admin')) {
      console.log("❌ Access denied for role:", decoded.role);
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // == INPUT VALIDATION ==
    const { bookId } = req.body;

    if (bookId == null || !Number.isFinite(Number(bookId))) {
      return res.status(400).json({ message: 'Invalid or missing bookId' });
    }
    
    console.log(`📖 Starting reading session for user ${decoded.userId}, book ${bookId}`);
    
    // == CHECK FOR EXISTING ACTIVE SESSION ==
    const activeSession = await db.query.readingSessions.findFirst({
      where: and(
        eq(schema.readingSessions.userId, decoded.userId),
        eq(schema.readingSessions.bookId, bookId),
        isNull(schema.readingSessions.endTime)
      )
    });

    if (activeSession) {
      console.log("⚠️ Active session already exists:", activeSession.id);
      return res.status(200).json({ 
        success: true, 
        message: 'Active session already exists',
        sessionId: activeSession.id,
        startTime: activeSession.startTime
      });
    }
    
    // == CREATE NEW READING SESSION ==
    const newSession = await db.insert(schema.readingSessions).values({
      userId: decoded.userId,
      bookId,
      startTime: new Date(),
      endTime: null, // Will be set when session ends
      totalMinutes: null // Will be calculated when session ends
    }).returning();

    // == SUCCESS RESPONSE ==
    console.log("✅ Reading session started successfully:", newSession[0].id);
    return res.status(200).json({ 
      success: true, 
      message: 'Reading session started successfully',
      sessionId: newSession[0].id,
      startTime: newSession[0].startTime,
      data: newSession[0]
    });
    
  } catch (error) {
    // == ERROR HANDLING ==
    console.error("❌ Error starting reading session:", error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
}