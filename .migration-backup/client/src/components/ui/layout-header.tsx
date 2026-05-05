import { useState } from "react";
import { Menu, X, Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";

export default function LayoutHeader() {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const openSearchModal = () => {
    // Implementation for search modal
  };

  const openRequestModal = () => {
    // Implementation for request station modal
  };

  const openAddStationModal = () => {
    // Implementation for add station modal
  };

  return (
    <nav className="absolute z-40 w-full text-white">
      <div className="border-b border-gray-900 bg-[#0E0E0E] sm:border-0">
        <div className="container mx-auto px-4">
          <div className="relative grid grid-cols-5 lg:flex lg:justify-between h-[70px] items-center lg:h-[90px]">
            {/* Mobile Menu Button */}
            <button
              className="inline-flex justify-self-start items-center justify-center rounded-md p-2 text-gray-400 focus:outline-none focus:ring-0 hover:bg-gray-900 hover:text-white lg:hidden"
              onClick={() => setIsMobileOpen(!isMobileOpen)}
            >
              <span className="sr-only">Open main menu</span>
              {!isMobileOpen ? (
                <Menu className="block h-6 w-6" aria-hidden="true" />
              ) : (
                <X className="block h-6 w-6" aria-hidden="true" />
              )}
            </button>

            {/* Logo */}
            <div className="col-span-2 justify-self-end">
              <div className="flex items-center justify-center lg:items-stretch lg:justify-start">
                <a href="/" className="not-active flex flex-shrink-0 items-center">
                  <img 
                    className="h-16 w-auto md:h-20" 
                    height="68" 
                    width="64" 
                    src="/logo-icon.webp"
                    alt="Megaradio" 
                  />
                  <div className="-ml-4 hidden text-xl text-white lg:block">
                    <span className="font-bold">mega</span>radio
                  </div>
                </a>
              </div>
            </div>

            <div className="flex items-center col-span-2 justify-self-end">
              <div className="absolute inset-y-0 right-0 hidden items-center pr-2 sm:static sm:inset-auto sm:ml-6 sm:pr-0 md:flex">
                <div className="hidden sm:ml-6 lg:block">
                  <div className="flex items-center sm:space-x-6 md:space-x-6 lg:space-x-4 xl:space-x-8">
                    <a href="#genres" className="nav-item">Genres</a>
                    <button onClick={openRequestModal} className="nav-item">
                      Request a Station
                    </button>
                    <button onClick={openAddStationModal} className="nav-item">
                      Add Your Station
                    </button>
                    {isAuthenticated && (
                      <a href="/profile/favorites" className="nav-item">
                        Your Favorites
                      </a>
                    )}

                    {/* Country Selector */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="rounded-[10px] bg-[#1D1D1D] p-2.5 text-[15px] font-bold">
                          <img 
                            src="https://flagcdn.com/24x18/us.png"
                            alt="Country"
                            className="w-6 h-4 rounded object-cover mr-2"
                          />
                          <ChevronDown className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem>Global</DropdownMenuItem>
                        <DropdownMenuItem>United States</DropdownMenuItem>
                        <DropdownMenuItem>United Kingdom</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Search Button */}
                    <button 
                      onClick={openSearchModal}
                      aria-label="Search radios"
                      className="rounded-[10px] bg-[#1D1D1D] p-2.5 text-[15px] font-bold"
                    >
                      <Search className="w-6 h-6" />
                    </button>

                    {!isAuthenticated && (
                      <>
                        <div className="mr-[50px] h-[33px] w-0.5 bg-[#222222]"></div>
                        <div className="flex sm:space-x-6 md:space-x-6 lg:space-x-4 xl:space-x-8">
                          <a href="/login" className="nav-item">Login</a>
                          <a 
                            href="/signup"
                            className="not-active rounded-3xl bg-[#FF4199] py-2.5 px-6 text-[15px] font-bold hover:bg-[#FF097B] transition-colors"
                          >
                            Sign Up
                          </a>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Mobile Country Selector */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="lg:hidden p-2">
                      <img 
                        src="https://flagcdn.com/24x18/us.png"
                        alt="Country"
                        className="w-6 h-4 rounded object-cover"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem>Global</DropdownMenuItem>
                    <DropdownMenuItem>United States</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* User Menu Dropdown */}
                {isAuthenticated && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="rounded-full">
                        <img 
                          src="/no-image.webp"
                          alt="User"
                          className="w-8 h-8 rounded-full"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem>Profile</DropdownMenuItem>
                      <DropdownMenuItem>Settings</DropdownMenuItem>
                      <DropdownMenuItem>Logout</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileOpen && (
        <div className="relative z-40 h-full bg-[#0E0E0E]/80 backdrop-blur lg:hidden">
          <div className="pt-4 pb-3">
            <div className="space-y-1">
              <a 
                href="#genres" 
                className="nav-item block px-4 py-2 text-base font-medium"
                onClick={() => setIsMobileOpen(false)}
              >
                Genres
              </a>
              
              <button 
                onClick={() => {
                  setIsMobileOpen(false);
                  openRequestModal();
                }}
                className="nav-item block px-4 py-2 text-base font-medium text-left w-full"
              >
                Request a Station
              </button>

              <button 
                onClick={() => {
                  setIsMobileOpen(false);
                  openAddStationModal();
                }}
                className="nav-item block px-4 py-2 text-base font-medium text-left w-full"
              >
                Add Your Station
              </button>

              {isAuthenticated ? (
                <a 
                  href="/profile/favorites"
                  className="nav-item block border-t border-gray-900 px-4 py-2 text-base font-medium"
                  onClick={() => setIsMobileOpen(false)}
                >
                  Your Favorites
                </a>
              ) : (
                <>
                  <a 
                    href="/login"
                    className="nav-item block border-t border-gray-900 px-4 py-2 text-base font-medium"
                    onClick={() => setIsMobileOpen(false)}
                  >
                    Login
                  </a>
                  <a 
                    href="/signup"
                    className="nav-item block px-4 py-2 text-base font-medium"
                    onClick={() => setIsMobileOpen(false)}
                  >
                    Sign Up
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}