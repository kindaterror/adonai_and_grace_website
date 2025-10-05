import { Request, Response } from 'express';
import { db } from '@db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const MAX_USERNAME_LEN = 100;

function sanitizeUsername(v: any) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, MAX_USERNAME_LEN);
}

// ✅ RESET PASSWORD WITH SECURITY VERIFICATION TOKEN
export async function resetPassword(req: Request, res: Response) {
  try {
    const username = sanitizeUsername(req.body?.username);
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    const resetToken = typeof req.body?.resetToken === 'string' ? req.body.resetToken.trim().slice(0, 512) : '';

    // Validate input
    if (!username || !newPassword || !confirmPassword || !resetToken) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required',
      });
    }

    // Check password match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Passwords do not match' 
      });
    }

    // Check password length
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Find user by username
  const user = await db.select().from(users).where(eq(users.username, username)).limit(1);

    if (user.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Username not found' 
      });
    }

    const userData = user[0];

    // Verify reset token
    if (!userData.passwordResetToken || userData.passwordResetToken !== resetToken) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    // Check if token is expired
    if (userData.passwordResetExpires && new Date() > userData.passwordResetExpires) {
      return res.status(400).json({ 
        success: false, 
        message: 'Reset token has expired. Please start the process again.' 
      });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user password and clear reset token
    await db.update(users)
      .set({
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      })
      .where(eq(users.id, userData.id));

    // Return success
    res.json({ 
      success: true, 
      message: 'Password reset successfully. You can now log in with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}