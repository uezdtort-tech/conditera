import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './store'

describe('useAppStore (Zustand)', () => {
  beforeEach(() => {
    // Сбрасываем состояние перед каждым тестом
    useAppStore.setState({
      chatOpen: false,
      cart: [],
      favorites: [],
    })
  })

  describe('initial state', () => {
    it('has empty cart by default', () => {
      const cart = useAppStore.getState().cart
      expect(Array.isArray(cart)).toBe(true)
    })

    it('has empty favorites by default', () => {
      const favorites = useAppStore.getState().favorites
      expect(Array.isArray(favorites)).toBe(true)
    })

    it('has products loaded', () => {
      const products = useAppStore.getState().products
      expect(Array.isArray(products)).toBe(true)
      expect(products.length).toBeGreaterThan(0)
    })

    it('has confectioners loaded', () => {
      const confectioners = useAppStore.getState().confectioners
      expect(Array.isArray(confectioners)).toBe(true)
      expect(confectioners.length).toBeGreaterThan(0)
    })

    it('has orders loaded', () => {
      const orders = useAppStore.getState().orders
      expect(Array.isArray(orders)).toBe(true)
    })

    it('has chatRooms loaded', () => {
      const rooms = useAppStore.getState().chatRooms
      expect(Array.isArray(rooms)).toBe(true)
    })
  })

  describe('chat actions', () => {
    it('setChatOpen toggles chat visibility', () => {
      expect(useAppStore.getState().chatOpen).toBe(false)
      useAppStore.getState().setChatOpen(true)
      expect(useAppStore.getState().chatOpen).toBe(true)
      useAppStore.getState().setChatOpen(false)
      expect(useAppStore.getState().chatOpen).toBe(false)
    })

    it('setActiveChatRoom sets active room id', () => {
      useAppStore.getState().setActiveChatRoom('test-room-id')
      expect(useAppStore.getState().activeChatRoom).toBe('test-room-id')
    })
  })

  describe('product actions', () => {
    it('toggleProductVisibility toggles isHidden flag', () => {
      const initialProducts = useAppStore.getState().products
      const firstProduct = initialProducts[0]
      if (!firstProduct) return // skip if no products

      const initialHidden = !!firstProduct.isHidden
      useAppStore.getState().toggleProductVisibility(firstProduct.id, 'test reason')
      const updated = useAppStore.getState().products.find((p: any) => p.id === firstProduct.id)
      expect(updated?.isHidden).toBe(!initialHidden)
      if (!initialHidden) {
        expect(updated?.hiddenReason).toBe('test reason')
        expect(updated?.hiddenAt).toBeTruthy()
      }

      // Тоггл обратно
      useAppStore.getState().toggleProductVisibility(firstProduct.id)
      const restored = useAppStore.getState().products.find((p: any) => p.id === firstProduct.id)
      expect(restored?.isHidden).toBe(initialHidden)
    })

    it('deleteProduct removes product by id', () => {
      const initialCount = useAppStore.getState().products.length
      const firstProduct = useAppStore.getState().products[0]
      if (!firstProduct) return
      useAppStore.getState().deleteProduct(firstProduct.id)
      expect(useAppStore.getState().products.length).toBe(initialCount - 1)
      expect(
        useAppStore.getState().products.find((p: any) => p.id === firstProduct.id)
      ).toBeUndefined()
    })

    it('updateProduct updates fields', () => {
      const firstProduct = useAppStore.getState().products[0]
      if (!firstProduct) return
      useAppStore.getState().updateProduct(firstProduct.id, { title: 'Test Updated Title' })
      const updated = useAppStore.getState().products.find((p: any) => p.id === firstProduct.id)
      expect(updated?.title).toBe('Test Updated Title')
    })
  })

  describe('user actions', () => {
    it('setUserCity sets city and location', () => {
      useAppStore.getState().setUserCity('Тула')
      expect(useAppStore.getState().userCity).toBe('Тула')
      expect(useAppStore.getState().userLocation?.city).toBe('Тула')
    })

    it('setUserCity with null clears city', () => {
      useAppStore.getState().setUserCity('Москва')
      useAppStore.getState().setUserCity(null)
      expect(useAppStore.getState().userCity).toBeNull()
    })
  })

  describe('favorites', () => {
    it('can be modified via setState', () => {
      useAppStore.setState({ favorites: ['p1', 'p2'] })
      expect(useAppStore.getState().favorites).toEqual(['p1', 'p2'])
    })
  })

  describe('venues', () => {
    it('has venues loaded', () => {
      const venues = useAppStore.getState().venues
      expect(Array.isArray(venues)).toBe(true)
      expect(venues.length).toBeGreaterThan(0)
    })

    it('has venueVendors loaded', () => {
      const vendors = useAppStore.getState().venueVendors
      expect(Array.isArray(vendors)).toBe(true)
      expect(vendors.length).toBeGreaterThan(0)
    })

    it('venue has fullAddress or address field', () => {
      const venue = useAppStore.getState().venues[0] as any
      expect(venue.fullAddress || venue.address).toBeTruthy()
    })

    it('venueVendors are linked to venues', () => {
      const venues = useAppStore.getState().venues
      const vendors = useAppStore.getState().venueVendors
      const venueIds = new Set(venues.map((v: any) => v.id))
      const linkedVendors = vendors.filter((vv: any) => venueIds.has(vv.venueId))
      expect(linkedVendors.length).toBeGreaterThan(0)
    })
  })

  describe('corporateEvents', () => {
    it('has events loaded', () => {
      const events = useAppStore.getState().corporateEvents
      expect(Array.isArray(events)).toBe(true)
    })
  })
})
