import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import Header from "@/components/layout/Header";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import { BookOpen, UserCircle, Clock, Award, ChevronRight, Bookmark, GraduationCap, Palette, Star, Target, TrendingUp, Heart, Lightbulb} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useEffect } from "react";
import { jwtDecode } from "jwt-decode";

// Import book preview images for the dashboard
import storybook1Image from "@/assets/books/book1.svg";
import educationalBookImage from "@/assets/books/educational1.svg";
import animatedStorybookImage from "@/assets/books/animated-storybook.svg.avif";

// Interface for JWT payload
interface JwtPayload {
  exp: number; // expiration timestamp (seconds)
}

// FIXED: Format reading time to handle seconds and display H:MM:SS format
const formatTime = (totalSeconds: number) => {
  if (!totalSeconds || totalSeconds === 0) return "0:00:00";
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export default function StudentDashboard() {
  const { user, logout } = useAuth();

  // --- JWT Session Timeout Auto-Logout ---
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const decoded = jwtDecode<JwtPayload>(token);
      const expiresAt = decoded.exp * 1000; // Convert seconds to ms
      const now = Date.now();

      if (expiresAt < now) {
        // Token already expired
        logout();
        alert("Session timed out. Please log in again.");
        window.location.href = "/login"; // or use your router's navigate
        return;
      }

      const timeout = expiresAt - now;
      const timer = setTimeout(() => {
        logout();
        alert("Session timed out. Please log in again.");
        window.location.href = "/login";
      }, timeout);

      return () => clearTimeout(timer);
    } catch (error) {
      console.error("Invalid token:", error);
      logout();
      window.location.href = "/login";
    }
  }, [logout]);

  // Fetch student progress
  const { data: progressData, isLoading: isLoadingProgress } = useQuery({
    queryKey: ["/api/progress"],
    queryFn: async () => {
      const response = await fetch("/api/progress", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch progress data");
      }
      
      return response.json();
    }
  });

  // Fetch books
  const { data: booksData, isLoading: isLoadingBooks } = useQuery({
    queryKey: ["/api/books"],
    queryFn: async () => {
      const response = await fetch("/api/books", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch books data");
      }
      
      return response.json();
    }
  });

  // Get books by type
  const getBooksByType = (type: string) => {
    if (!booksData?.books) return [];
    return booksData.books.filter((book: any) => book.type === type);
  };

  // FIXED: Get currently reading books with duplicate handling
  const getCurrentlyReading = () => {
    if (!progressData?.progress) return [];
    
    // 🔍 DEBUG: Log all data
    console.log("🔍 All progress data:", progressData.progress);
    
    // FIXED: Remove duplicates - keep only the highest progress for each book
    const uniqueProgress = progressData.progress.reduce((acc: any[], current: any) => {
      const existing = acc.find(p => p.bookId === current.bookId);
      if (!existing || current.percentComplete > existing.percentComplete) {
        return [...acc.filter(p => p.bookId !== current.bookId), current];
      }
      return acc;
    }, []);
    
    console.log("🔍 After removing duplicates:", uniqueProgress);
    
    const filtered = uniqueProgress.filter((p: any) => {
      console.log(`📊 Book: ${p.book?.title}, Progress: ${p.percentComplete}, Type: ${typeof p.percentComplete}`);
      return p.percentComplete < 100;
    });
    
    console.log("📝 Filtered books (continue reading):", filtered);
    
    return filtered
      .sort((a: any, b: any) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime())
      .slice(0, 2);
  };

  // FIXED: Calculate completed books count with duplicate handling
  const getCompletedBooksCount = () => {
    if (!progressData?.progress) return 0;
    
    // Remove duplicates first, then count completed books
    const uniqueProgress = progressData.progress.reduce((acc: any[], current: any) => {
      const existing = acc.find(p => p.bookId === current.bookId);
      if (!existing || current.percentComplete > existing.percentComplete) {
        return [...acc.filter(p => p.bookId !== current.bookId), current];
      }
      return acc;
    }, []);
    
    return uniqueProgress.filter((p: any) => p.percentComplete === 100).length;
  };

  // FIXED: Calculate total reading time with duplicate handling (keep in seconds)
  const getTotalReadingTime = () => {
    if (!progressData?.progress) return 0;
    
    // Remove duplicates first, then sum reading time
    const uniqueProgress = progressData.progress.reduce((acc: any[], current: any) => {
      const existing = acc.find(p => p.bookId === current.bookId);
      if (!existing || current.percentComplete > existing.percentComplete) {
        return [...acc.filter(p => p.bookId !== current.bookId), current];
      }
      return acc;
    }, []);
    
    // FIXED: Keep totalReadingTime in seconds for proper formatting
    const totalSeconds = uniqueProgress.reduce((sum: number, p: any) => sum + (p.totalReadingTime || 0), 0);
    return totalSeconds;
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-navy-50 to-ilaw-white">
      <Header variant="student" />
      
      <main className="flex-grow p-4 md:p-6">
        <div className="container mx-auto">
          {/* UPDATED: Welcome Section - Removed duplicate school name */}
          <div className="bg-gradient-to-r from-ilaw-navy to-brand-navy-800 rounded-2xl p-4 md:p-8 mb-4 text-ilaw-white shadow-navy">
            <div className="flex items-center mb-3">
              <Lightbulb className="h-8 md:h-10 w-8 md:w-10 text-ilaw-gold mr-3 md:mr-4" />
              <div>
                <span className="text-sm font-semibold uppercase tracking-wide text-brand-gold-200">
                  Student Portal
                </span>
              </div>
            </div>
            <h1 className="text-xl md:text-3xl font-sans font-bold mb-2">
              Welcome back, {user?.firstName || "Student"}! 🌟
              </h1>
            <p className="text-sm md:text-base text-brand-gold-100 leading-relaxed">
              {user?.gradeLevel ? 
                `${user.gradeLevel === 'K' ? 'Kindergarten' : `Grade ${user.gradeLevel}`} Student • ` : 
                ''}
              Continue your amazing learning journey and discover the light of knowledge through reading!
            </p>
            <div className="mt-6 flex items-center text-ilaw-gold">
              <Star className="h-5 w-5 mr-2" />
              <span className="font-medium italic">Liwanag, Kaalaman, Paglilingkod</span>
            </div>
          </div>

{/* Currently Reading Section - responsive sizes */}
<div className="mb-6 border-4 md:border-8 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-white rounded-2xl p-6 md:p-8">
  <div className="flex items-center mb-6">
    <BookOpen className="h-7 w-7 text-ilaw-gold mr-3" />
    <h2 className="text-2xl font-sans font-bold text-ilaw-navy">
      Continue Your Reading Journey
    </h2>
  </div>

  {isLoadingProgress ? (
    <div className="flex justify-center py-12">
      <div className="flex items-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-ilaw-gold border-t-transparent mr-3"></div>
        <span className="text-yellow-600 font-sans font-bold">
          Loading your books...
        </span>
      </div>
    </div>
  ) : getCurrentlyReading().length > 0 ? (
  <div className="grid md:grid-cols-2 gap-6">
      {getCurrentlyReading().map((progress: any) => (
        <div
          key={progress.id}
          className="bg-gradient-to-br from-brand-gold-50 to-ilaw-white p-4 md:p-6 rounded-xl border-2 border-brand-gold-400 hover:shadow-ilaw transition-all duration-300 group"
        >
          <div className="flex gap-4">
            {/* Book Cover */}
            <div className="flex-shrink-0 w-16 h-24 md:w-20 md:h-28 bg-gradient-to-br from-ilaw-gold to-brand-amber rounded-lg flex items-center justify-center text-ilaw-navy shadow-lg group-hover:scale-105 transition-transform duration-300">
              {progress.book.coverImage ? (
                <img
                  src={progress.book.coverImage}
                  alt={progress.book.title}
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : (
                <BookOpen className="h-8 w-8" />
              )}
            </div>

            {/* Book Details */}
            <div className="flex-1 min-w-0">
              <h3 className="font-sans font-bold text-base md:text-lg text-ilaw-navy mb-1 truncate">
                {progress.book.title}
              </h3>
              <p className="text-yellow-600 font-sans font-bold text-sm mb-3">
                {progress.currentChapter || "Chapter 1"}
              </p>

              {/* Progress Bar */}
                <div className="mb-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-sans font-extrabold text-yellow-600">
                    Progress
                  </span>
                  <span className="text-sm font-sans font-extrabold text-ilaw-navy">
                    {progress.percentComplete}% Complete
                  </span>
                </div>
                <Progress
                  value={progress.percentComplete}
                  className="h-2 md:h-3 bg-brand-gold-200"
                />
              </div>

              {/* Continue Button with Link wrapper */}
              <div className="flex justify-end">
                <Link
                  href={
                    progress.book.type === "educational"
                      ? `/student/educational-books/${progress.book.id}`
                      : `/student/storybooks/${progress.book.id}`
                  }
                >
                  <Button className="bg-ilaw-gold hover:bg-brand-amber text-ilaw-navy font-sans font-bold px-4 md:px-5 py-2 text-base md:text-lg group-hover:scale-105 transition-all duration-300 shadow-ilaw w-auto">
                    Continue Reading
                    <ChevronRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="text-center py-12 bg-gradient-to-br from-brand-gold-50 to-ilaw-white rounded-xl border-2 border-brand-gold-200">
      <BookOpen className="h-16 w-16 mx-auto mb-4 text-brand-gold-300" />
      <h3 className="text-xl font-sans font-bold text-yellow-600 mb-2">
        Ready to Start Reading?
      </h3>
      <p className="text-yellow-600 font-sans font-bold mb-6">
        Discover amazing stories and educational books waiting for you!
      </p>
      <Link href="/student/storybooks">
        <Button className="bg-ilaw-gold hover:bg-brand-amber text-ilaw-navy font-sans font-bold px-6 py-3 text-lg shadow-ilaw">
          <Heart className="mr-2 h-5 w-5" />
          Discover Books to Read
        </Button>
      </Link>
    </div>
  )}
</div>


{/* Book Categories Tiles */}
<div className="mb-8">
  {/* compact 3-column grid even on small screens; reduced padding and image sizes */}
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-8 mb-8">
    {/* Storybooks Card */}
    <Card className="hover:shadow-ilaw transition-all duration-300 border-4 sm:border-6 md:border-8 border-brand-gold-400 hover:border-ilaw-gold group hover:scale-105">
     <CardContent className="p-3 sm:p-4 md:p-8 flex flex-col items-center text-center h-full bg-gradient-to-br from-ilaw-white to-brand-navy-50">
       <div className="mb-3 sm:mb-4 md:mb-6 w-16 h-16 sm:w-20 sm:h-20 md:w-36 md:h-36 group-hover:scale-110 transition-transform duration-300">
         <img src={storybook1Image} alt="Storybooks" className="w-full h-full object-contain" />
       </div>
      <h2 className="text-2xl font-sans font-bold mb-3 text-ilaw-navy">Storybooks</h2>
      <p className="text-yellow-600 font-sans font-bold mb-6 leading-relaxed">
        Dive into exciting adventures and magical tales that spark your imagination!
      </p>
      <Link href="/student/storybooks">
        <Button className="bg-ilaw-navy hover:bg-brand-navy-800 text-ilaw-gold font-sans font-bold px-4 py-2 text-base flex items-center gap-2 group-hover:scale-105 transition-all duration-300 shadow-navy w-full sm:w-auto">
          <Bookmark size={18} />
          Browse Storybooks
        </Button>
      </Link>
    </CardContent>
  </Card>

    {/* Animated Storybooks Card */}
    <Card className="hover:shadow-navy transition-all duration-300 border-4 sm:border-6 md:border-8 border-purple-400 hover:border-purple-600 group hover:scale-105">
     <CardContent className="p-3 sm:p-4 md:p-8 flex flex-col items-center text-center bg-gradient-to-br from-purple-50 to-indigo-50">
       <div className="mb-3 sm:mb-4 md:mb-6 w-16 h-16 sm:w-20 sm:h-20 md:w-36 md:h-36 relative group-hover:scale-110 transition-transform duration-300">
         <img src={animatedStorybookImage} alt="Animated Storybooks" className="w-full h-full object-contain" />
         <div className="absolute -top-2 -right-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg animate-pulse font-sans">
           NEW!
         </div>
       </div>
      <h2 className="text-2xl font-sans font-bold mb-3 text-purple-700">2D Animated Stories</h2>
      <p className="text-purple-600 font-sans font-bold mb-6 leading-relaxed">
        Experience interactive Filipino folk tales with amazing animations - perfect for all grade levels!
      </p>
      <Link href="/student/twodanimation">
        <Button className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-sans font-bold px-4 py-2 text-base flex items-center gap-2 group-hover:scale-105 transition-all duration-300 shadow-lg w-full sm:w-auto">
          <Palette size={18} />
          Explore Animated Stories
        </Button>
      </Link>
    </CardContent>
  </Card>

    {/* Educational Books Card */}
    <Card className="hover:shadow-ilaw transition-all duration-300 border-4 sm:border-6 md:border-8 border-brand-gold-400 hover:border-ilaw-gold group hover:scale-105">
     <CardContent className="p-3 sm:p-4 md:p-8 flex flex-col items-center text-center h-full bg-gradient-to-br from-ilaw-white to-brand-navy-50">
       <div className="mb-3 sm:mb-4 md:mb-6 w-16 h-16 sm:w-20 sm:h-20 md:w-36 md:h-36 group-hover:scale-110 transition-transform duration-300">
         <img src={educationalBookImage} alt="Educational Books" className="w-full h-full object-contain" />
       </div>
      <h2 className="text-2xl font-sans font-bold mb-3 text-ilaw-navy">Educational Books</h2>
      <p className="text-yellow-600 font-sans font-bold mb-6 leading-relaxed">
        Boost your knowledge with our comprehensive educational materials and learning resources.
      </p>
      <Link href="/student/educational-books">
        <Button className="bg-ilaw-navy hover:bg-brand-navy-800 text-ilaw-gold font-sans font-bold px-4 py-2 text-base flex items-center gap-2 group-hover:scale-105 transition-all duration-300 shadow-navy w-full sm:w-auto">
          <GraduationCap size={18} />
          Browse Educational Books
        </Button>
      </Link>
    </CardContent>
  </Card>
  </div>
</div>
{/* Reading Progress Section - compact on phones */}
<div className="border-4 sm:border-8 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-white rounded-2xl p-4 sm:p-6 md:p-8">
  <div className="flex items-center mb-6">
    <TrendingUp className="h-6 w-6 sm:h-7 sm:w-7 text-ilaw-gold mr-3" />
    <h2 className="text-xl sm:text-2xl font-sans font-bold text-ilaw-navy">Your Learning Progress</h2>
  </div>

  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6">
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-3 sm:p-6 rounded-lg text-center border border-green-200 hover:border-green-400 transition-all duration-300">
      <div className="bg-gradient-to-br from-green-400 to-emerald-500 p-3 sm:p-4 rounded-full w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 flex items-center justify-center">
        <BookOpen className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
      </div>
      <h3 className="text-xl sm:text-2xl font-sans font-bold text-green-600 mb-1">{getCompletedBooksCount()}</h3>
      <p className="text-sm sm:text-base text-green-600 font-bold">Books Completed</p>
    </div>

    <div className="bg-gradient-to-br from-blue-50 to-cyan-50 p-3 sm:p-6 rounded-lg text-center border border-blue-200 hover:border-blue-400 transition-all duration-300">
      <div className="bg-gradient-to-br from-blue-400 to-cyan-500 p-3 sm:p-4 rounded-full w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 flex items-center justify-center">
        <Clock className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
      </div>
      <h3 className="text-xl sm:text-2xl font-sans font-bold text-blue-600 mb-1">{formatTime(getTotalReadingTime())}</h3>
      <p className="text-sm sm:text-base text-blue-600 font-bold">Hours Read</p>
    </div>

    <div className="bg-gradient-to-br from-ilaw-gold to-brand-amber p-3 sm:p-6 rounded-lg text-center border border-brand-gold-300 hover:border-ilaw-gold transition-all duration-300">
      <div className="bg-gradient-to-br from-ilaw-navy to-brand-navy-800 p-3 sm:p-4 rounded-full w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 flex items-center justify-center">
        <Award className="h-6 w-6 sm:h-8 sm:w-8 text-ilaw-gold" />
      </div>
      <h3 className="text-xl sm:text-2xl font-sans font-bold text-ilaw-navy mb-1">{Math.floor(getCompletedBooksCount() / 2)}</h3>
      <p className="text-sm sm:text-base text-ilaw-navy font-bold">Badges Earned</p>
    </div>
  </div>
  
  <div className="text-center">
    <Link href="/student/progress">
      <Button
        variant="outline"
        className="border-2 border-ilaw-gold text-ilaw-navy font-bold px-8 py-3 text-lg 
                   transition-all duration-300 hover:bg-ilaw-gold hover:text-white"
      >
        View Detailed Progress
        <ChevronRight className="ml-2 h-5 w-5" />
      </Button>
    </Link>
  </div>
</div>

{/* Motivational Quote Section - UPDATED: Softer background */}
<div className="mt-8 bg-gradient-to-r from-amber-200 to-yellow-200 rounded-2xl p-8 text-center text-ilaw-navy">
  <Star className="h-10 w-10 mx-auto mb-4" />
  <blockquote className="text-xl md:text-2xl font-sans font-bold mb-4">
    "The more that you read, the more things you will know. The more that you learn, the more places you'll go."
  </blockquote>
  <p className="font-sans font-bold">— Dr. Seuss</p>
  <div className="mt-4 text-lg font-sans font-bold italic">
    Keep shining bright, young learner! ✨
  </div>
</div>
        </div>
      </main>
    </div>
  );
}