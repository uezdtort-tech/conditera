/**
 * App store — auth state + cart + favorites.
 *
 * Uses AsyncStorage for persistence (same pattern as web's localStorage).
 * Auth tokens themselves are stored in SecureStore (encrypted) separately.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  authApi,
  setTokens,
  clearTokens,
  type User,
  type Product,
  type Order,
} from "@/api/client";

interface CartItem {
  productId: string;
  title: string;
  image: string;
  price: number;
  quantity: number;
  confectionerId?: string;
  customization?: Record<string, unknown>;
}

interface AppState {
  // ===== Auth =====
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    phone: string;
  }) => Promise<void>;
  logout: () => Promise<void>;

  // ===== Cart =====
  cart: CartItem[];
  addToCart: (product: Product, quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  cartTotal: () => number;
  cartCount: () => number;

  // ===== Favorites =====
  favorites: string[];
  toggleFavorite: (productId: string) => void;
  isFavorite: (productId: string) => boolean;

  // ===== City =====
  city: string | null;
  setCity: (city: string) => void;

  // ===== Orders (cached) =====
  orders: Order[];
  setOrders: (orders: Order[]) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const { user, accessToken, refreshToken } = await authApi.login(email, password);
          await setTokens(accessToken, refreshToken);
          set({ user, isAuthenticated: true, isLoading: false });
        } catch (e) {
          set({ isLoading: false });
          throw e;
        }
      },

      register: async (data) => {
        set({ isLoading: true });
        try {
          const { user, accessToken, refreshToken } = await authApi.register(data);
          await setTokens(accessToken, refreshToken);
          set({ user, isAuthenticated: true, isLoading: false });
        } catch (e) {
          set({ isLoading: false });
          throw e;
        }
      },

      logout: async () => {
        await clearTokens();
        set({ user: null, isAuthenticated: false, cart: [], favorites: [] });
      },

      // ===== Cart =====
      cart: [],
      addToCart: (product, quantity = 1) => {
        const cart = get().cart;
        const existing = cart.find((i) => i.productId === product.id);
        if (existing) {
          set({
            cart: cart.map((i) =>
              i.productId === product.id
                ? { ...i, quantity: i.quantity + quantity }
                : i
            ),
          });
        } else {
          set({
            cart: [
              ...cart,
              {
                productId: product.id,
                title: product.title,
                image: product.images[0] || "",
                price: product.price,
                quantity,
                confectionerId: product.confectionerId,
              },
            ],
          });
        }
      },
      removeFromCart: (productId) =>
        set({ cart: get().cart.filter((i) => i.productId !== productId) }),

      updateQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeFromCart(productId);
          return;
        }
        set({
          cart: get().cart.map((i) =>
            i.productId === productId ? { ...i, quantity } : i
          ),
        });
      },

      clearCart: () => set({ cart: [] }),

      cartTotal: () =>
        get().cart.reduce((sum, i) => sum + i.price * i.quantity, 0),

      cartCount: () => get().cart.reduce((sum, i) => sum + i.quantity, 0),

      // ===== Favorites =====
      favorites: [],
      toggleFavorite: (productId) => {
        const favorites = get().favorites;
        set({
          favorites: favorites.includes(productId)
            ? favorites.filter((id) => id !== productId)
            : [...favorites, productId],
        });
      },
      isFavorite: (productId) => get().favorites.includes(productId),

      // ===== City =====
      city: null,
      setCity: (city) => set({ city }),

      // ===== Orders =====
      orders: [],
      setOrders: (orders) => set({ orders }),
    }),
    {
      name: "conditera-mobile",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        cart: state.cart,
        favorites: state.favorites,
        city: state.city,
      }),
    }
  )
);

// Expose store on window for debugging / e2e test automation
if (typeof window !== "undefined") {
   
  (window as any).useAppStore = useAppStore;
}
