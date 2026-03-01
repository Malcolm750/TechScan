import React, { useState, useEffect, useRef } from 'react';
import { Camera, Search, History, Zap, ZapOff, X, Check, Package, ArrowLeft, AlertCircle, User, LogOut, MapPin, Lock, ChevronDown, Eye, EyeOff, Trash2 } from 'lucide-react';

import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;


export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [selectedStore, setSelectedStore] = useState('');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  
  const [toastMessage, setToastMessage] = useState(null);

  const [activeTab, setActiveTab] = useState('scan');
  const [viewState, setViewState] = useState('camera'); 
  const [scannedCode, setScannedCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [currentProduct, setCurrentProduct] = useState(null);
  
  const [isProductExpanded, setIsProductExpanded] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  const [history, setHistory] = useState([]);
  const [flashOn, setFlashOn] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const longPressTimer = useRef(null);
  const isLongPress = useRef(false);

  // --- VERROUILLAGE INTELLIGENT DE L'ORIENTATION ---
  useEffect(() => {
    const lockOrientation = async () => {
      if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
        if (window.innerWidth >= 768) {
          try {
            await window.screen.orientation.lock('landscape');
          } catch (error) {
            console.log("Verrouillage orientation paysage ignoré.");
          }
        }
      }
    };
    lockOrientation();
  }, []);

  const stateRef = useRef({ viewState, isScanning, scannedCode: '', lastScanTime: 0, isProductExpanded: false });
  useEffect(() => {
    stateRef.current.viewState = viewState;
    stateRef.current.isScanning = isScanning;
    stateRef.current.scannedCode = scannedCode;
    stateRef.current.isProductExpanded = isProductExpanded;
  }, [viewState, isScanning, scannedCode, isProductExpanded]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchHistory = async (userId) => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from('historique_scans')
        .select('*')
        .eq('user_id', userId)
        .order('scanned_at', { ascending: false })
        .limit(50);
        
      if (error) throw error;
      
      const uniqueHistory = [];
      const codes = new Set();
      
      if (data) {
         data.forEach(row => {
           let detailsObj = row.details;
           if (typeof detailsObj === 'string') {
             try { detailsObj = JSON.parse(detailsObj); } 
             catch (err) { console.error("Format JSON invalide:", row); }
           }
           if (detailsObj && !codes.has(row.code_barre)) {
             codes.add(row.code_barre);
             uniqueHistory.push(detailsObj);
           }
         });
      }
      setHistory(uniqueHistory);
    } catch (e) {
      console.error("Erreur fetch historique:", e);
    }
  };

  useEffect(() => {
    if (!supabase) {
       const savedHistory = localStorage.getItem('techscan_history');
       if (savedHistory) setHistory(JSON.parse(savedHistory));
       return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        fetchHistory(session.user.id);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        fetchHistory(session.user.id);
      } else {
        setProfile(null);
        setHistory([]);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error) throw error;
      if (data) {
        setProfile(data);
        if (data.magasins_autorises && data.magasins_autorises.length > 0) {
          setSelectedStore(data.magasins_autorises[0]);
        }
      }
    } catch (error) {
      console.error("Erreur profil:", error);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!rememberMe) sessionStorage.setItem('techscan_no_remember', 'true');
    } catch (error) {
      setAuthError("Identifiants incorrects ou problème de connexion.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
  };

  const handleSearch = async (code) => {
    setIsScanning(true);
    setScannedCode(code);
    
    stateRef.current.isScanning = true;
    stateRef.current.scannedCode = code;
    stateRef.current.lastScanTime = Date.now();
    
    if (!supabase) {
      showToast("Mode de test : Recherche simulée pour " + code);
      setIsScanning(false);
      stateRef.current.isScanning = false;
      setViewState('not-found');
      return;
    }

    try {
      const { data: product, error } = await supabase.from('articles').select('*').eq('code_barre', code).maybeSingle();
      if (error) throw error;

      let finalProduct = product;

      if (!finalProduct) {
        const { data: pendingData, error: pendingError } = await supabase.from('articles_a_creer').select('*').eq('code_barre', code).limit(1);
        if (pendingError) throw pendingError;

        if (pendingData && pendingData.length > 0) {
          const pendingProduct = pendingData[0];
          finalProduct = {
            code_barre: pendingProduct.code_barre,
            photo: pendingProduct.photo_url,
            designation: 'En cours de création',
            marque: 'Validation en attente',
            reference_fabricant: 'N/A',
            statut: 'En attente',
            date_creation: pendingProduct.created_at || new Date().toISOString()
          };
        }
      }

      setIsScanning(false);
      stateRef.current.isScanning = false;

      if (finalProduct) {
        setCurrentProduct(finalProduct);
        setIsProductExpanded(false); 
        setViewState('product');
        addToHistory(finalProduct);
      } else {
        setViewState('not-found');
      }
    } catch (error) {
      setIsScanning(false);
      stateRef.current.isScanning = false;
      showToast("Erreur de connexion à la base de données.");
    }
  };

  const addToHistory = async (product) => {
    setHistory(prevHistory => {
      const newEntry = { ...product, scanDate: new Date().toISOString() };
      const newHistory = [newEntry, ...prevHistory.filter(h => h.code_barre !== product.code_barre)].slice(0, 50);
      if (!supabase) localStorage.setItem('techscan_history', JSON.stringify(newHistory));
      return newHistory;
    });

    if (!supabase || !session) return;
    try {
      await supabase.from('historique_scans').delete().match({ user_id: session.user.id, code_barre: product.code_barre });
      await supabase.from('historique_scans').insert([{
        user_id: session.user.id,
        magasin: selectedStore || 'Inconnu',
        code_barre: product.code_barre,
        details: product,
        trouve: true
      }]);
    } catch (e) {
      console.error("Erreur update historique DB:", e);
    }
  };

  const clearAllHistory = async () => {
    if (window.confirm("Voulez-vous vraiment vider tout l'historique ?")) {
      setHistory([]);
      if (!supabase) localStorage.removeItem('techscan_history');
      if (supabase && session) {
        try { await supabase.from('historique_scans').delete().eq('user_id', session.user.id); } catch(e) {}
      }
    }
  };

  const deleteFromHistory = async (codeBarre) => {
    setHistory(prevHistory => {
      const newHistory = prevHistory.filter(h => h.code_barre !== codeBarre);
      if (!supabase) localStorage.setItem('techscan_history', JSON.stringify(newHistory));
      return newHistory;
    });

    if (supabase && session) {
      try { await supabase.from('historique_scans').delete().match({ user_id: session.user.id, code_barre: codeBarre }); } catch(e) {}
    }
  };

  const handleItemPressStart = (item) => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      if (navigator.vibrate) navigator.vibrate(50);
      if (window.confirm(`Supprimer "${item.designation || item.code_barre}" de l'historique ?`)) {
        deleteFromHistory(item.code_barre);
      }
    }, 700); 
  };

  const handleItemPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handleHistoryItemClick = (item) => {
    if (isLongPress.current) return; 
    setCurrentProduct(item);
    setIsProductExpanded(true); 
    setViewState('product'); 
  };

  useEffect(() => {
    let timeoutId;
    if (viewState === 'product' && !isProductExpanded) {
      timeoutId = setTimeout(() => { resetToScan(); }, 5000);
    }
    return () => { if (timeoutId) clearTimeout(timeoutId); };
  }, [viewState, isProductExpanded]);

  const handleTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientY);
  };
  const handleTouchMove = (e) => { setTouchEnd(e.targetTouches[0].clientY); };
  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance > 50 && !isProductExpanded) setIsProductExpanded(true);
    if (distance < -50 && !isProductExpanded) resetToScan();
    if (distance < -50 && isProductExpanded) setIsProductExpanded(false);
    setTouchStart(null); setTouchEnd(null);
  };

  useEffect(() => {
    let stream = null;
    let scanInterval = null;

    const startScanner = async () => {
      if (session && activeTab === 'scan' && videoRef.current && navigator.mediaDevices) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: 'environment',
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            } 
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;

            // --- NOUVEAU : FORCER LA MISE AU POINT CONTINUE (AUTOFOCUS) ---
            try {
              const track = stream.getVideoTracks()[0];
              const capabilities = track.getCapabilities ? track.getCapabilities() : null;
              
              // Si l'appareil supporte le réglage du mode de focus
              if (capabilities && capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                await track.applyConstraints({
                  advanced: [{ focusMode: 'continuous' }]
                });
                console.log("Autofocus continu activé");
              }
            } catch (focusErr) {
              console.log("Impossible d'activer l'autofocus avancé:", focusErr);
            }
            // -------------------------------------------------------------
            
            if ('BarcodeDetector' in window) {
              const barcodeDetector = new window.BarcodeDetector();
              scanInterval = setInterval(async () => {
                if ((stateRef.current.viewState === 'camera' || stateRef.current.viewState === 'product' || stateRef.current.viewState === 'not-found') 
                    && !stateRef.current.isScanning 
                    && !stateRef.current.isProductExpanded 
                    && videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                  try {
                    const barcodes = await barcodeDetector.detect(videoRef.current);
                    if (barcodes.length > 0) {
                      const code = barcodes[0].rawValue;
                      const now = Date.now();
                      
                      if (code !== stateRef.current.scannedCode || (now - stateRef.current.lastScanTime > 2500)) {
                         if (navigator.vibrate) navigator.vibrate([50]);
                         handleSearch(code);
                      }
                    }
                  } catch (e) {}
                }
              }, 400);
            }
          }
        } catch (err) {
          console.error("Erreur caméra:", err);
        }
      }
    };
    startScanner();
    return () => {
      if (scanInterval) clearInterval(scanInterval);
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [activeTab, session]); 

  const takePicture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.95));
      setViewState('photo-preview');
    }
  };

  const saveNewArticle = async () => {
    if (!supabase || !session) return;
    setIsUploading(true);

    try {
      const { data: existing } = await supabase.from('articles_a_creer').select('id').eq('code_barre', scannedCode).maybeSingle();
      if (existing) {
        showToast("Cet article a déjà été soumis par quelqu'un d'autre !");
        resetToScan();
        return;
      }

      const res = await fetch(capturedPhoto);
      const blob = await res.blob();
      const fileName = `${scannedCode}_${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage.from('photos_articles').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('photos_articles').getPublicUrl(fileName);

      const { error: dbError } = await supabase.from('articles_a_creer').insert([{ 
          code_barre: scannedCode, photo_url: publicUrlData.publicUrl, statut: 'en_attente', cree_par: session.user.id, magasin: selectedStore
      }]);
      if (dbError) throw dbError;
      
      const pendingArticle = {
        code_barre: scannedCode, photo: publicUrlData.publicUrl, designation: 'En cours de création', marque: 'Validation en attente', reference_fabricant: 'N/A', statut: 'En attente'
      };
      addToHistory(pendingArticle);
      showToast("Article enregistré avec succès !");
      resetToScan();
    } catch (error) {
      showToast("Erreur lors de la sauvegarde.");
    } finally {
      setIsUploading(false);
    }
  };

  const resetToScan = () => {
    setViewState('camera');
    setScannedCode('');
    setManualCode('');
    setCurrentProduct(null);
    setCapturedPhoto(null);
    setIsProductExpanded(false);
  };

  // --- VUES DE L'APPLICATION ---

  if (!supabase) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white p-8">
        <div className="bg-slate-800 p-8 rounded-3xl max-w-md w-full text-center border border-slate-700 shadow-2xl">
          <AlertCircle size={64} className="mx-auto text-orange-500 mb-6" />
          <h1 className="text-2xl font-bold mb-4">Configuration Requise</h1>
          <p className="text-slate-400">Veuillez configurer vos variables d'environnement Vercel et décommenter les lignes Supabase.</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 p-6">
        <div className="bg-slate-800 p-8 md:p-10 rounded-[2.5rem] max-w-md w-full shadow-2xl border border-slate-700 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Package size={40} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white text-center mb-2">TechScan</h1>
          <p className="text-slate-400 text-center mb-8">Connectez-vous pour accéder au magasin</p>
          {authError && <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-2xl mb-6 text-sm text-center">{authError}</div>}
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-slate-300 text-sm font-bold mb-2 block">Identifiant (Email)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500"><User size={20} /></div>
                <input type="email" required className="w-full bg-slate-900 border border-slate-700 text-white rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500 transition-colors" placeholder="prenom.nom@magasin.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-slate-300 text-sm font-bold mb-2 block">Mot de passe</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500"><Lock size={20} /></div>
                <input type={showPassword ? "text" : "password"} required className="w-full bg-slate-900 border border-slate-700 text-white rounded-2xl py-4 pl-12 pr-12 focus:outline-none focus:border-blue-500 transition-colors" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-300 transition-colors">
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <input type="checkbox" id="remember" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-5 h-5 rounded-md border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="remember" className="text-sm text-slate-300 font-medium cursor-pointer">Se souvenir de moi</label>
            </div>
            <button type="submit" disabled={authLoading} className="w-full py-4 mt-4 bg-blue-600 rounded-2xl text-white text-lg font-bold shadow-lg shadow-blue-500/30 hover:bg-blue-500 active:scale-[0.98] transition-all disabled:opacity-50">
              {authLoading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const renderScannerUI = () => (
    <>
      {/* Zone de scan repensée : Carrée sur mobile (portrait), Rectangulaire sur tablette */}
      {(!isProductExpanded) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-64 h-64 sm:w-72 sm:h-72 md:w-3/4 md:h-auto md:max-w-md md:aspect-video relative rounded-3xl shadow-[inset_0_0_0_2px_rgba(255,255,255,0.2)] bg-black/10 backdrop-blur-[1px]">
            <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-blue-500 rounded-tl-3xl"></div>
            <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-blue-500 rounded-tr-3xl"></div>
            <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-blue-500 rounded-bl-3xl"></div>
            <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-blue-500 rounded-br-3xl"></div>
            
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-3xl">
               {isScanning ? (
                  <div className="w-full h-1 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)] animate-pulse" style={{ animation: 'scanline 1.5s linear infinite' }}></div>
               ) : (
                  <span className="text-white/90 text-sm font-bold bg-black/60 px-5 py-2.5 rounded-full backdrop-blur-md">Alignez le code</span>
               )}
            </div>
          </div>
        </div>
      )}

      {viewState === 'camera' && (
        <>
          <div className="absolute top-20 right-4 md:top-6 md:right-6 flex gap-4 z-20">
            <button onClick={() => setFlashOn(!flashOn)} className={`p-4 md:p-4 rounded-full backdrop-blur-md transition-colors shadow-lg ${flashOn ? 'bg-yellow-400 text-black' : 'bg-black/50 text-white hover:bg-black/70'}`}>
              {flashOn ? <Zap size={28} /> : <ZapOff size={28} />}
            </button>
          </div>
          {/* Bouton de saisie manuelle remonté sur mobile pour ne pas toucher la barre de navigation */}
          <div className="absolute bottom-24 md:bottom-12 w-full px-8 flex justify-center items-center z-20">
             <button onClick={() => setViewState('manual-entry')} className="bg-black/70 border border-white/20 backdrop-blur-md text-white px-6 py-4 rounded-full flex items-center gap-3 font-semibold hover:bg-black/90 transition shadow-xl active:scale-95">
                <Search size={22} /> Saisie manuelle
             </button>
          </div>
        </>
      )}
    </>
  );

  const renderProductOverlay = () => {
    if (!currentProduct) return null;
    const displayImage = currentProduct.image_reference || currentProduct.photo || 'https://images.unsplash.com/photo-1586772002130-b0f3daa6288b?auto=format&fit=crop&q=80&w=600';

    if (!isProductExpanded) {
      // MODE COMPACT MOBILE : Bottom-16 permet de se placer exactement au dessus de la barre de navigation native (h-16)
      return (
        <div 
          className="absolute bottom-16 md:bottom-0 left-0 right-0 bg-white rounded-t-[2rem] shadow-[0_-15px_40px_rgba(0,0,0,0.15)] z-[60] animate-in slide-in-from-bottom-full duration-300 cursor-pointer overflow-hidden pb-4 md:pb-8"
          onClick={() => setIsProductExpanded(true)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mt-3 mb-2"></div>
          
          <div className="px-5 pb-2 flex gap-4 items-center">
            <div className="w-20 h-20 md:w-28 md:h-28 bg-white border border-slate-100 rounded-2xl flex items-center justify-center shrink-0 p-2 shadow-sm">
              <img src={displayImage} alt="..." className="max-w-full max-h-full object-contain rounded-xl" />
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col justify-center">
               <h3 className="text-lg md:text-2xl font-extrabold text-slate-800 leading-tight truncate mb-0.5">{currentProduct.designation || 'Article'}</h3>
               <p className="text-sm font-bold text-slate-500 truncate">{currentProduct.marque || 'Marque N/A'}</p>
               <p className="text-xs font-mono font-bold text-slate-400 mt-1">{currentProduct.code_barre}</p>
            </div>
            
            <div className="flex flex-col items-end shrink-0 ml-1 gap-2">
               <button onClick={(e) => { e.stopPropagation(); resetToScan(); }} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition active:bg-slate-200">
                 <X size={20} />
               </button>
               <div className="flex items-center gap-1.5 mr-1">
                 <div className={`w-3 h-3 rounded-full ${currentProduct.statut === 'Actif' ? 'bg-green-500 shadow-sm' : currentProduct.statut === 'En attente' ? 'bg-orange-500 shadow-sm animate-pulse' : currentProduct.statut ? 'bg-orange-500 shadow-sm' : 'bg-slate-300'}`}></div>
               </div>
            </div>
          </div>
        </div>
      );
    }

    // MODE PLEIN ÉCRAN : z-[100] pour recouvrir la barre de navigation sur mobile
    return (
      <div 
        className="absolute inset-0 bg-slate-50 z-[100] overflow-y-auto animate-in slide-in-from-bottom-10 duration-300 pb-10 md:pb-0"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="relative h-64 md:h-72 bg-white flex justify-center items-center shadow-sm p-8 pt-16 border-b border-slate-200">
           <button 
             onClick={(e) => { 
                e.stopPropagation(); 
                activeTab === 'history' ? resetToScan() : setIsProductExpanded(false); 
             }} 
             className="absolute top-4 left-4 md:top-6 md:left-6 p-3 md:p-4 rounded-full bg-slate-100 text-slate-800 z-10 hover:bg-slate-200 transition shadow-sm active:scale-95"
           >
             {activeTab === 'history' ? <ArrowLeft size={24} /> : <ChevronDown size={24} />}
           </button>
           <img src={displayImage} alt={currentProduct.designation} className="max-w-full max-h-full object-contain drop-shadow-sm" />
        </div>

        <div className="max-w-3xl mx-auto -mt-6 relative z-20 px-4 space-y-4">
           <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-slate-100">
              <div className="flex justify-between items-start mb-3 gap-4">
                 <div className="flex-1">
                    <h1 className="text-2xl md:text-4xl font-extrabold text-slate-800 leading-tight">{currentProduct.designation || 'Article'}</h1>
                    <p className="text-md md:text-lg text-slate-500 font-bold mt-1">{currentProduct.marque || 'Marque N/A'}</p>
                 </div>
                 {currentProduct.statut && (
                   <div className={`px-3 py-1.5 md:px-4 md:py-2 rounded-2xl flex flex-col items-center justify-center border ${currentProduct.statut === 'Actif' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                      <span className="text-xs md:text-sm font-bold uppercase tracking-wider">{currentProduct.statut}</span>
                   </div>
                 )}
              </div>
              
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
                {currentProduct.groupe && <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">{currentProduct.groupe}</span>}
                {currentProduct.famille && <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">{currentProduct.famille}</span>}
                {currentProduct.type && <span className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full">{currentProduct.type}</span>}
              </div>
           </div>

           <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-3 md:px-6 md:py-4 bg-slate-50 border-b border-slate-100">
                 <h3 className="text-md md:text-lg font-bold text-slate-800 flex items-center gap-2">
                   <Package size={18} className="text-blue-500" /> Détails techniques
                 </h3>
              </div>
              
              <div className="p-1 md:p-2">
                 <div className="p-3 md:p-4 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"><Search size={18} /></div>
                       <div className="min-w-0">
                          <p className="text-xs md:text-sm font-bold text-slate-800">Code Barre</p>
                          <p className="text-xs md:text-sm text-slate-500 font-mono font-medium mt-0.5 truncate">{currentProduct.code_barre}</p>
                       </div>
                    </div>
                 </div>
                 
                 <div className="p-3 md:p-4 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"><AlertCircle size={18} /></div>
                       <div className="min-w-0">
                          <p className="text-xs md:text-sm font-bold text-slate-800">Réf. Fabricant</p>
                          <p className="text-xs md:text-sm text-slate-500 font-mono font-medium mt-0.5 truncate">{currentProduct.reference_fabricant || 'Non renseignée'}</p>
                       </div>
                    </div>
                 </div>

                 <div className="p-3 md:p-4 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"><MapPin size={18} /></div>
                       <div className="min-w-0">
                          <p className="text-xs md:text-sm font-bold text-slate-800">Emplacement / Magasin</p>
                          <p className="text-xs md:text-sm font-medium text-slate-500 mt-0.5 truncate">{currentProduct.site_rattachement || 'Non défini'}</p>
                       </div>
                    </div>
                 </div>

                 <div className="p-3 md:p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"><History size={18} /></div>
                       <div className="min-w-0">
                          <p className="text-xs md:text-sm font-bold text-slate-800">Date d'ajout</p>
                          <p className="text-xs md:text-sm font-medium text-slate-500 mt-0.5 truncate">
                             {currentProduct.date_creation ? new Date(currentProduct.date_creation).toLocaleDateString('fr-FR') : 'Inconnue'}
                          </p>
                       </div>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>
    );
  };

  const renderNotFoundOverlay = () => {
    return (
      <div className="absolute bottom-16 md:bottom-0 left-0 right-0 bg-white rounded-t-[2rem] shadow-[0_-15px_50px_rgba(0,0,0,0.15)] z-[60] animate-in slide-in-from-bottom-full duration-300 p-5 md:p-6 pb-6 md:pb-8 border-t-4 border-orange-500">
         <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto -mt-2 mb-5"></div>
         <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-4">
               <div className="w-12 h-12 md:w-14 md:h-14 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
                  <AlertCircle size={28} />
               </div>
               <div>
                  <h3 className="text-xl md:text-2xl font-extrabold text-slate-800 leading-tight">Introuvable</h3>
                  <p className="text-xs md:text-sm font-mono font-bold text-slate-500 mt-0.5">{scannedCode}</p>
               </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); resetToScan(); }} className="p-2.5 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 transition">
               <X size={20} />
            </button>
         </div>
         <button onClick={() => setViewState('take-photo')} className="w-full py-3.5 md:py-4 mt-2 bg-blue-600 rounded-2xl text-white text-md md:text-lg font-bold flex items-center justify-center gap-3 hover:bg-blue-700 transition shadow-lg shadow-blue-500/30 active:scale-95">
            <Camera size={22} /> Créer la fiche produit
         </button>
      </div>
    );
  };

  const renderManualEntry = () => (
    <div className="absolute inset-0 bg-slate-50 flex flex-col p-6 md:p-8 animate-in fade-in duration-200 z-[100]">
      <button onClick={() => setViewState('camera')} className="w-fit p-3 md:p-4 rounded-full bg-white shadow-sm border border-slate-200 text-slate-600 mb-6 hover:bg-slate-100 transition active:scale-95"><ArrowLeft size={24} /></button>
      <div className="max-w-xl mx-auto w-full flex-1 flex flex-col justify-center">
        <h2 className="text-3xl md:text-4xl font-extrabold text-slate-800 mb-3">Saisie manuelle</h2>
        <div className="bg-white p-2 md:p-3 rounded-2xl shadow-sm border-2 border-slate-200 flex items-center mb-6">
          <input type="text" autoFocus className="flex-1 bg-transparent border-none text-2xl md:text-3xl p-3 md:p-4 outline-none font-mono text-slate-800 uppercase rounded-xl w-full" placeholder="Ex: 316514..." value={manualCode} onChange={(e) => setManualCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch(manualCode)} />
        </div>
        <button onClick={() => handleSearch(manualCode)} disabled={!manualCode} className="w-full py-4 md:py-6 rounded-2xl bg-blue-600 text-white text-xl md:text-2xl font-bold shadow-lg shadow-blue-500/30 disabled:opacity-50 active:scale-95 transition-transform">Rechercher l'article</button>
      </div>
    </div>
  );

  const renderTakePhotoUI = () => (
    <div className="absolute inset-0 z-[100] flex flex-col animate-in fade-in duration-200">
      <div className="absolute top-4 left-4 md:top-6 md:left-6 z-10">
         <button onClick={() => setViewState('not-found')} className="p-3 md:p-4 rounded-full bg-black/50 text-white backdrop-blur-md hover:bg-black/70 transition shadow-lg active:scale-95"><ArrowLeft size={24} /></button>
      </div>
      
      {/* Zone de focus centrale */}
      <div className="flex-1 relative flex items-center justify-center pointer-events-none">
        <div className="absolute inset-0 border-[20px] md:border-[15px] border-black/50"></div>
        <div className="absolute inset-x-8 top-[20%] bottom-[25%] md:inset-10 border-2 border-dashed border-white/50 rounded-3xl flex items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
          <span className="bg-black/60 text-white px-5 py-2.5 rounded-full backdrop-blur-sm text-sm font-bold shadow-lg">Cadrez la pièce</span>
        </div>
      </div>
      
      <div className="absolute bottom-0 left-0 right-0 h-40 md:h-48 bg-black flex items-center justify-center pb-6 md:pb-8 border-t border-white/10">
        <button onClick={takePicture} className="w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-transform bg-black">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-white rounded-full"></div>
        </button>
      </div>
    </div>
  );

  const renderPhotoPreview = () => (
    <div className="absolute inset-0 bg-slate-900 flex flex-col animate-in fade-in duration-200 z-[100]">
       <div className="flex-1 relative p-6 flex flex-col justify-center">
         <h3 className="text-white text-center text-2xl md:text-3xl font-bold mb-6">Image Nette ?</h3>
         <div className="w-full max-w-2xl mx-auto rounded-3xl overflow-hidden shadow-2xl border-2 md:border-4 border-slate-700 bg-black">
           <img src={capturedPhoto} alt="Aperçu" className="w-full h-auto object-contain max-h-[50vh] rounded-2xl" />
         </div>
       </div>
       <div className="bg-slate-800 p-6 flex gap-4 md:gap-6 pb-10 rounded-t-3xl">
          <button onClick={() => setViewState('take-photo')} disabled={isUploading} className="flex-1 py-4 md:py-6 rounded-2xl bg-slate-700 hover:bg-slate-600 text-white text-lg md:text-xl font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 active:scale-95">
            <X size={24} /> Refaire
          </button>
          <button onClick={saveNewArticle} disabled={isUploading} className="flex-1 py-4 md:py-6 rounded-2xl bg-green-500 hover:bg-green-400 text-white text-lg md:text-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 transition disabled:opacity-50 active:scale-95">
            {isUploading ? <span className="animate-pulse">Envoi...</span> : <><Check size={24} /> Valider</>}
          </button>
       </div>
    </div>
  );

  const renderHistory = () => (
    <div className="w-full h-full bg-slate-50 flex flex-col relative z-10 pb-16 md:pb-0">
      <div className="bg-white p-5 md:p-6 shadow-sm sticky top-0 flex items-center justify-between border-b border-slate-100 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-800 flex items-center gap-2"><History className="text-blue-600" size={28} /> Historique</h2>
        </div>
        {history.length > 0 && (
          <button onClick={clearAllHistory} className="p-2 md:p-3 text-red-500 hover:bg-red-50 rounded-full transition-colors flex items-center justify-center shrink-0 active:bg-red-100" title="Vider l'historique">
            <Trash2 size={22} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-3 md:space-y-4">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 pb-20">
            <Package size={64} className="mb-4 opacity-30" />
            <p className="text-lg font-bold">Aucun article scanné</p>
          </div>
        ) : (
          history.map((item) => (
            <div key={item.code_barre} 
                 onClick={() => { 
                    setCurrentProduct(item); 
                    setIsProductExpanded(true); 
                    setViewState('product'); 
                 }} 
                 className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4 cursor-pointer hover:shadow-md transition-all active:scale-[0.98]">
              <div className="w-16 h-16 md:w-20 md:h-20 bg-white border border-slate-100 rounded-xl md:rounded-2xl p-1 flex items-center justify-center shrink-0 shadow-sm relative">
                 <img src={item.image_reference || item.photo || 'https://images.unsplash.com/photo-1586772002130-b0f3daa6288b?auto=format&fit=crop&q=80&w=100'} alt="..." className="max-w-full max-h-full object-contain rounded-lg" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-lg md:text-xl font-bold text-slate-800 truncate mb-0.5 flex items-center gap-2">
                  {item.designation || 'Article'}
                  {item.statut === 'En attente' && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black bg-orange-100 text-orange-600 border border-orange-200 uppercase tracking-wider">
                      Création
                    </span>
                  )}
                </h4>
                <p className="text-sm md:text-md text-slate-500 font-medium truncate">{item.marque || 'Marque N/A'} <span className="text-slate-300 mx-1.5">•</span> {item.reference_fabricant || 'Réf N/A'}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full bg-slate-900 font-sans text-slate-900 overflow-hidden flex-col md:flex-row relative">
      
      {/* Notifications Toasts - Placés en haut pour ne pas être cachés par la Bottom Nav */}
      {toastMessage && (
        <div className="absolute top-16 md:top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-5 py-3 md:px-6 md:py-4 rounded-2xl shadow-2xl z-[110] font-bold text-sm text-center border border-slate-700 animate-in slide-in-from-top-4">
           {toastMessage}
        </div>
      )}

      {/* HEADER TOP (Mobile) - Épuré et plat */}
      <div className="md:hidden w-full bg-white/95 backdrop-blur-md px-4 py-3 flex justify-between items-center z-50 border-b border-slate-100 shadow-sm absolute top-0 left-0 right-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-extrabold shrink-0 shadow-sm text-sm">
            {profile?.prenom?.charAt(0) || <User size={18} />}
          </div>
          <div className="flex flex-col min-w-0 pr-2">
             <span className="text-sm font-bold leading-tight truncate">{profile?.prenom} {profile?.nom}</span>
             {profile?.magasins_autorises && profile.magasins_autorises.length > 1 ? (
                <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="text-xs text-slate-500 font-semibold bg-transparent outline-none p-0 border-none cursor-pointer">
                  {profile.magasins_autorises.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
             ) : (
                <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1 truncate uppercase tracking-wide"><MapPin size={10} className="shrink-0"/> {selectedStore || 'Magasin N/A'}</span>
             )}
          </div>
        </div>
        <button onClick={handleLogout} className="p-2 text-slate-400 bg-slate-50 rounded-full hover:bg-red-50 hover:text-red-500 transition-colors shrink-0 active:scale-95"><LogOut size={18} /></button>
      </div>

      {/* SIDEBAR (Desktop) */}
      <nav className="hidden md:flex flex-col w-72 h-full bg-white border-r border-slate-200 z-50 justify-between p-5 shadow-sm relative">
        <div>
          <div className="flex items-center gap-4 px-2 mb-10 mt-2">
             <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-500/30 flex items-center justify-center">
                <Package size={28} />
             </div>
             <span className="text-2xl font-black text-slate-800">TechScan</span>
          </div>

          <div className="space-y-3">
             <button onClick={() => { setActiveTab('scan'); if(viewState !== 'camera') resetToScan(); }} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all ${activeTab === 'scan' ? 'bg-blue-50 text-blue-700 font-bold shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 font-semibold'}`}>
               <Camera size={24} strokeWidth={activeTab === 'scan' ? 2.5 : 2} /> Scanner
             </button>
             <button onClick={() => setActiveTab('history')} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all ${activeTab === 'history' ? 'bg-blue-50 text-blue-700 font-bold shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 font-semibold'}`}>
               <History size={24} strokeWidth={activeTab === 'history' ? 2.5 : 2} /> Historique
             </button>
          </div>
        </div>

        <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100 shadow-sm">
           <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 overflow-hidden">
                 <div className="w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold shrink-0">
                    {profile?.prenom?.charAt(0) || <User size={20} />}
                 </div>
                 <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold text-slate-800 truncate">{profile?.prenom} {profile?.nom}</span>
                 </div>
              </div>
              <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all shrink-0" title="Se déconnecter"><LogOut size={18} /></button>
           </div>
           
           <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                 <MapPin size={14} />
              </div>
              {profile?.magasins_autorises && profile.magasins_autorises.length > 1 ? (
                <>
                  <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 appearance-none focus:outline-none focus:border-blue-500 focus:ring-1 shadow-sm cursor-pointer truncate">
                     {profile.magasins_autorises.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                     <ChevronDown size={14} />
                  </div>
                </>
              ) : (
                <div className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 truncate flex items-center h-full shadow-sm">
                  {selectedStore || 'N/A'}
                </div>
              )}
           </div>
        </div>
      </nav>

      {/* BOTTOM NAV (Mobile) - Fixée au bas comme une App iOS/Android standard */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-slate-200 flex justify-around items-center h-16 z-[70] pb-safe shadow-[0_-5px_15px_rgba(0,0,0,0.05)]">
        <button onClick={() => { setActiveTab('scan'); if(viewState !== 'camera') resetToScan(); }} className={`flex-1 flex flex-col items-center justify-center h-full transition-colors ${activeTab === 'scan' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
          <Camera size={24} strokeWidth={activeTab === 'scan' ? 2.5 : 2} className={activeTab === 'scan' ? '-translate-y-0.5 transition-transform' : 'transition-transform'} />
          <span className="text-[10px] font-bold mt-1">Scan</span>
        </button>
        <button onClick={() => setActiveTab('history')} className={`flex-1 flex flex-col items-center justify-center h-full transition-colors ${activeTab === 'history' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
          <History size={24} strokeWidth={activeTab === 'history' ? 2.5 : 2} className={activeTab === 'history' ? '-translate-y-0.5 transition-transform' : 'transition-transform'} />
          <span className="text-[10px] font-bold mt-1">Historique</span>
        </button>
      </nav>

      {/* MAIN AREA */}
      <main className="flex-1 relative overflow-hidden bg-slate-900 h-full pt-[64px] md:pt-0">
        
        <div className={`w-full h-full ${activeTab === 'history' ? 'block' : 'hidden'} bg-slate-50`}>
           {renderHistory()}
        </div>
        
        <div className={`w-full h-full relative ${activeTab === 'scan' ? 'block' : 'hidden'}`}>
           <video ref={videoRef} autoPlay playsInline muted className={`absolute inset-0 w-full h-full object-cover ${(viewState === 'camera' || viewState === 'take-photo' || viewState === 'product' || viewState === 'not-found') ? 'opacity-80' : 'opacity-0'}`} />
           <canvas ref={canvasRef} className="hidden" />

           {(viewState === 'camera' || viewState === 'product' || viewState === 'not-found') && renderScannerUI()}
           {viewState === 'take-photo' && renderTakePhotoUI()}
           {viewState === 'photo-preview' && renderPhotoPreview()}
           {viewState === 'manual-entry' && renderManualEntry()}
           {viewState === 'product' && renderProductOverlay()}
           {viewState === 'not-found' && renderNotFoundOverlay()}
        </div>

      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scanline { 0% { transform: translateY(-120px); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(120px); opacity: 0; } }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
      `}} />
    </div>
  );
}