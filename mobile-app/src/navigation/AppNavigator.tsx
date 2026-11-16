/**
 * App navigation — React Navigation with bottom tabs + nested stacks.
 *
 * Tabs:
 *   🏠 Главная        — home feed with promotions, popular cakes
 *   🛍 Каталог        — product catalog with filters
 *   🛒 Корзина        — cart + checkout
 *   ❤️ Избранное      — favorited products
 *   👤 Профиль        — profile / auth / orders / loyalty / settings
 *
 * Each tab has its own stack for detail screens (Product, Confectioner, etc.)
 */
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "react-native";

import { HomeScreen } from "@/screens/HomeScreen";
import { CatalogScreen } from "@/screens/CatalogScreen";
import { ProductDetailScreen } from "@/screens/ProductDetailScreen";
import { ConfectionerDetailScreen } from "@/screens/ConfectionerDetailScreen";
import { ConfectionersScreen } from "@/screens/ConfectionersScreen";
import { NearbyConfectionersScreen } from "@/screens/NearbyConfectionersScreen";
import { CartScreen } from "@/screens/CartScreen";
import { CheckoutScreen } from "@/screens/CheckoutScreen";
import { FavoritesScreen } from "@/screens/FavoritesScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { AuthScreen } from "@/screens/AuthScreen";
import { OrdersScreen } from "@/screens/OrdersScreen";
import { OrderDetailScreen } from "@/screens/OrderDetailScreen";
import { LoyaltyScreen } from "@/screens/LoyaltyScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { NotificationPreferencesScreen } from "@/screens/NotificationPreferencesScreen";
import { ChatListScreen } from "@/screens/ChatListScreen";
import { ChatDetailScreen } from "@/screens/ChatDetailScreen";
import { ARViewerScreen } from "@/screens/ARViewerScreen";
import { BiometricScreen } from "@/screens/BiometricScreen";
import { VerificationBannerScreen } from "@/screens/VerificationBannerScreen";
import { OperatorDashboardScreen } from "@/screens/OperatorDashboardScreen";
import { SimpleXScreen } from "@/screens/SimpleXScreen";
import { Colors } from "@/theme";

export type RootStackParamList = {
  Home: undefined;
  Catalog: { category?: string; q?: string } | undefined;
  ProductDetail: { id: string };
  ConfectionerDetail: { id: string };
  Confectioners: undefined;
  NearbyConfectioners: undefined;
  Cart: undefined;
  Checkout: undefined;
  Favorites: undefined;
  Profile: undefined;
  Auth: { mode?: "login" | "register" };
  Orders: undefined;
  OrderDetail: { id: string };
  Loyalty: undefined;
  Notifications: undefined;
  NotificationPreferences: undefined;
  ChatList: undefined;
  ChatDetail: { roomId: string; roomName: string };
  ARViewer: {
    modelUrl: string;
    modelUsdzUrl?: string;
    posterImage?: string;
    productName: string;
  };
  Biometric: undefined;
  SimpleX: undefined;
  VerificationBanner: undefined;
  OperatorDashboard: undefined;
};

const Tab = createBottomTabNavigator<RootStackParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Кондитера" }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: "Товар" }} />
      <Stack.Screen name="ConfectionerDetail" component={ConfectionerDetailScreen} options={{ title: "Кондитер" }} />
      <Stack.Screen name="Catalog" component={CatalogScreen} options={{ title: "Каталог" }} />
      <Stack.Screen name="Confectioners" component={ConfectionersScreen} options={{ title: "Кондитеры" }} />
      <Stack.Screen name="NearbyConfectioners" component={NearbyConfectionersScreen} options={{ title: "Рядом со мной" }} />
      <Stack.Screen name="ARViewer" component={ARViewerScreen} options={{ title: "3D / AR превью" }} />
      <Stack.Screen name="ChatList" component={ChatListScreen} options={{ title: "Чаты" }} />
      <Stack.Screen name="ChatDetail" component={ChatDetailScreen} options={{ title: "Чат" }} />
    </Stack.Navigator>
  );
}

function CatalogStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Catalog" component={CatalogScreen} options={{ title: "Каталог" }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: "Товар" }} />
      <Stack.Screen name="ConfectionerDetail" component={ConfectionerDetailScreen} options={{ title: "Кондитер" }} />
      <Stack.Screen name="NearbyConfectioners" component={NearbyConfectionersScreen} options={{ title: "Рядом со мной" }} />
      <Stack.Screen name="ARViewer" component={ARViewerScreen} options={{ title: "3D / AR превью" }} />
    </Stack.Navigator>
  );
}

function CartStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Cart" component={CartScreen} options={{ title: "Корзина" }} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} options={{ title: "Оформление заказа" }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: "Товар" }} />
    </Stack.Navigator>
  );
}

function FavoritesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ title: "Избранное" }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: "Товар" }} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Профиль" }} />
      <Stack.Screen name="Auth" component={AuthScreen} options={{ title: "Вход" }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: "Мои заказы" }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: "Заказ" }} />
      <Stack.Screen name="Loyalty" component={LoyaltyScreen} options={{ title: "Лояльность" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Уведомления" }} />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ title: "Настройки уведомлений" }}
      />
      <Stack.Screen name="ChatList" component={ChatListScreen} options={{ title: "Чаты" }} />
      <Stack.Screen name="ChatDetail" component={ChatDetailScreen} options={{ title: "Чат" }} />
      <Stack.Screen name="Biometric" component={BiometricScreen} options={{ title: "Биометрия" }} />
      <Stack.Screen name="NearbyConfectioners" component={NearbyConfectionersScreen} options={{ title: "Рядом со мной" }} />
      <Stack.Screen name="VerificationBanner" component={VerificationBannerScreen} options={{ title: "Статус модерации" }} />
      <Stack.Screen name="OperatorDashboard" component={OperatorDashboardScreen} options={{ title: "Оператор" }} />
      <Stack.Screen name="SimpleX" component={SimpleXScreen} options={{ title: "SimpleX (E2E)" }} />
    </Stack.Navigator>
  );
}

export function AppNavigator() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  return (
    <NavigationContainer
      theme={{
        dark: isDark,
        colors: {
          primary: Colors.primary,
          background: isDark ? Colors.backgroundDark : Colors.background,
          card: isDark ? Colors.surfaceDark : Colors.background,
          text: isDark ? Colors.textDark : Colors.text,
          border: isDark ? Colors.borderDark : Colors.border,
          notification: Colors.primary,
        },
        fonts: {
          regular: { fontFamily: "System", fontWeight: "400" },
          medium: { fontFamily: "System", fontWeight: "500" },
          bold: { fontFamily: "System", fontWeight: "700" },
          heavy: { fontFamily: "System", fontWeight: "900" },
        },
      }}
    >
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName: keyof typeof Ionicons.glyphMap = "home";

            if (route.name === "Home") iconName = focused ? "home" : "home-outline";
            else if (route.name === "Catalog") iconName = focused ? "grid" : "grid-outline";
            else if (route.name === "Cart") iconName = focused ? "cart" : "cart-outline";
            else if (route.name === "Favorites") iconName = focused ? "heart" : "heart-outline";
            else if (route.name === "Profile") iconName = focused ? "person" : "person-outline";

            return <Ionicons name={iconName} size={size} color={color} />;
          },
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarStyle: {
            paddingBottom: 4,
            height: 60,
          },
          headerShown: false,
        })}
      >
        <Tab.Screen
          name="Home"
          component={HomeStack}
          options={{ tabBarLabel: "Главная" }}
        />
        <Tab.Screen
          name="Catalog"
          component={CatalogStack}
          options={{ tabBarLabel: "Каталог" }}
        />
        <Tab.Screen
          name="Cart"
          component={CartStack}
          options={{ tabBarLabel: "Корзина" }}
        />
        <Tab.Screen
          name="Favorites"
          component={FavoritesStack}
          options={{ tabBarLabel: "Избранное" }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileStack}
          options={{ tabBarLabel: "Профиль" }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
