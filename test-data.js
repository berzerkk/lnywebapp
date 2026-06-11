/* ============================================================================
   L&S — Banques de questions du test de niveau, une par langue.
   10 questions par langue, graduées A1 -> C2.
   { t: énoncé, o: [4 options], a: index de la bonne réponse, e: explication (FR) }
   Utilisé par index.html (1re question du teaser) et test-de-niveau.html.
   ============================================================================ */
window.LS_TESTS = {
  "Anglais": [
    { t: "“She ___ to work every day.”", o: ["go","goes","going","gone"], a: 1, e: "À la 3ᵉ personne du singulier (she/he/it) au présent simple, le verbe prend un -s : « she goes »." },
    { t: "“There ___ some milk in the fridge.”", o: ["is","are","am","be"], a: 0, e: "« milk » est indénombrable, donc singulier : « there is »." },
    { t: "“I have lived here ___ 2019.”", o: ["for","since","during","from"], a: 1, e: "« since » marque le point de départ précis (2019) ; « for » indique une durée." },
    { t: "“If it rains tomorrow, we ___ at home.”", o: ["stay","stayed","will stay","would stay"], a: 2, e: "1ʳᵉ conditionnelle : if + présent, puis « will » + base verbale." },
    { t: "“He suggested ___ a break.”", o: ["to take","taking","take","took"], a: 1, e: "« suggest » est suivi du gérondif (-ing) : « taking »." },
    { t: "“By the time we arrived, the film ___.”", o: ["started","has started","had started","was starting"], a: 2, e: "Une action antérieure à une autre dans le passé → past perfect « had started »." },
    { t: "“I wish I ___ more time to prepare.”", o: ["have","had","will have","am having"], a: 1, e: "« I wish » + prétérit pour exprimer un regret au présent : « had »." },
    { t: "“___ harder, she would have passed.”", o: ["If she studied","Had she studied","She had studied","Did she study"], a: 1, e: "Inversion de la 3ᵉ conditionnelle : « Had she studied » = « If she had studied »." },
    { t: "“The proposal was met with ___ scepticism.”", o: ["a few","considerable","many","plenty"], a: 1, e: "« scepticism » est indénombrable : on emploie « considerable » (et non « many/a few »)." },
    { t: "“His argument, ___ compelling, ultimately lacked evidence.”", o: ["however","albeit","whereas","despite"], a: 1, e: "« albeit » = « bien que » ; il introduit une concession (« albeit compelling »)." }
  ],
  "Français": [
    { t: "« Elle ___ au travail tous les jours. »", o: ["va","vas","allez","vont"], a: 0, e: "À la 3ᵉ personne du singulier, le verbe « aller » fait « elle va »." },
    { t: "« Il y ___ du lait dans le frigo. »", o: ["a","as","ont","est"], a: 0, e: "Tournure impersonnelle « il y a »." },
    { t: "« J'habite ici ___ 2019. »", o: ["pour","depuis","pendant","dès"], a: 1, e: "« depuis » marque le point de départ d'une action qui continue." },
    { t: "« S'il pleut demain, nous ___ à la maison. »", o: ["restons","resterons","sommes restés","restions"], a: 1, e: "Après « si + présent », on emploie le futur : « nous resterons »." },
    { t: "« Il a proposé de ___ une pause. »", o: ["prendre","prenant","pris","prend"], a: 0, e: "« proposer de » est suivi de l'infinitif : « prendre »." },
    { t: "« Quand nous sommes arrivés, le film ___. »", o: ["a commencé","avait commencé","commence","commençait"], a: 1, e: "Antériorité dans le passé → plus-que-parfait « avait commencé »." },
    { t: "« Je voudrais qu'il ___ plus de temps. »", o: ["a","avait","ait","aura"], a: 2, e: "« vouloir que » entraîne le subjonctif : « qu'il ait »." },
    { t: "« ___ plus tôt, elle aurait réussi. »", o: ["Si elle étudiait","Si elle avait étudié","Avait-elle étudié","Elle étudiait"], a: 1, e: "Condition irréelle du passé : « si » + plus-que-parfait, puis conditionnel passé." },
    { t: "« La proposition a été accueillie avec un scepticisme ___. »", o: ["considérable","peu","beaucoup","plein"], a: 0, e: "L'adjectif « considérable » qualifie « scepticisme » (les autres ne sont pas des adjectifs)." },
    { t: "« Son argument, ___ convaincant, manquait de preuves. »", o: ["cependant","quoique","tandis","malgré"], a: 1, e: "« quoique » = « bien que » : il introduit une concession (+ adjectif)." }
  ],
  "Italien": [
    { t: "« Lei ___ al lavoro ogni giorno. »", o: ["va","vai","andare","vanno"], a: 0, e: "« lei » (3ᵉ pers. sing.) : « andare » fait « va »." },
    { t: "« C'___ del latte nel frigo. »", o: ["è","sono","ha","hanno"], a: 0, e: "« c'è » = il y a (singulier)." },
    { t: "« Abito qui ___ il 2019. »", o: ["per","dal","durante","fino"], a: 1, e: "« dal » exprime le point de départ (depuis)." },
    { t: "« Se domani piove, ___ a casa. »", o: ["restiamo","resteremo","restassimo","restavamo"], a: 1, e: "Futur « resteremo » dans une hypothèse réelle (se + présent)." },
    { t: "« Ha proposto di ___ una pausa. »", o: ["fare","facendo","fatto","fa"], a: 0, e: "Après « proposto di », l'infinitif : « fare »." },
    { t: "« Quando siamo arrivati, il film ___. »", o: ["è cominciato","era cominciato","comincia","cominciava"], a: 1, e: "Antériorité passée → trapassato « era cominciato »." },
    { t: "« Vorrei che lui ___ più tempo. »", o: ["ha","aveva","avesse","avrà"], a: 2, e: "« vorrei che » entraîne le subjonctif : « avesse »." },
    { t: "« Se ___ di più, avrebbe superato l'esame. »", o: ["studiava","avesse studiato","ha studiato","studiò"], a: 1, e: "Période hypothétique de l'irréel : « se avesse studiato »." },
    { t: "« La proposta fu accolta con ___ scetticismo. »", o: ["poco","notevole","molti","tanti"], a: 1, e: "« notevole » (considérable) qualifie « scetticismo » au singulier." },
    { t: "« Il suo argomento, ___ convincente, mancava di prove. »", o: ["tuttavia","sebbene","mentre","nonostante"], a: 1, e: "« sebbene » = « bien que » : concession suivie de l'adjectif." }
  ],
  "Espagnol": [
    { t: "« Ella ___ al trabajo todos los días. »", o: ["va","vas","ir","van"], a: 0, e: "« ella » (3ᵉ pers.) : « ir » fait « va »." },
    { t: "« ___ leche en la nevera. »", o: ["Hay","Es","Está","Tiene"], a: 0, e: "« hay » (de haber) = il y a." },
    { t: "« Vivo aquí ___ 2019. »", o: ["por","desde","durante","de"], a: 1, e: "« desde » marque le point de départ (depuis)." },
    { t: "« Si llueve mañana, nos ___ en casa. »", o: ["quedamos","quedaremos","quedáramos","quedábamos"], a: 1, e: "Futur « quedaremos » après « si + présent »." },
    { t: "« Sugirió ___ un descanso. »", o: ["tomar","tomando","tomado","toma"], a: 0, e: "Après « sugirió », l'infinitif : « tomar »." },
    { t: "« Cuando llegamos, la película ya ___. »", o: ["empezó","había empezado","empieza","empezaba"], a: 1, e: "Antériorité passée → pluscuamperfecto « había empezado »." },
    { t: "« Ojalá ___ más tiempo. »", o: ["tengo","tenía","tuviera","tendré"], a: 2, e: "« ojalá » entraîne le subjonctif : « tuviera »." },
    { t: "« Si ___ más, habría aprobado. »", o: ["estudiaba","hubiera estudiado","estudió","estudia"], a: 1, e: "Condition irréelle : « si hubiera estudiado »." },
    { t: "« La propuesta fue recibida con un escepticismo ___. »", o: ["considerable","poco","muchos","lleno"], a: 0, e: "« considerable » qualifie « escepticismo »." },
    { t: "« Su argumento, ___ convincente, carecía de pruebas. »", o: ["sin embargo","aunque","mientras","a pesar"], a: 1, e: "« aunque » = « bien que » : concession suivie de l'adjectif." }
  ],
  "Allemand": [
    { t: "„Sie ___ jeden Tag zur Arbeit.“", o: ["geht","gehen","gehst","gegangen"], a: 0, e: "« sie » (elle, 3ᵉ pers. sing.) : « gehen » fait « geht »." },
    { t: "„Es ___ Milch im Kühlschrank.“", o: ["gibt","ist","hat","sind"], a: 0, e: "« es gibt » = il y a." },
    { t: "„Ich wohne hier ___ 2019.“", o: ["für","seit","während","ab"], a: 1, e: "« seit » = depuis (point de départ)." },
    { t: "„Wenn es morgen regnet, ___ wir zu Hause.“", o: ["bleiben","blieben","geblieben","bliebe"], a: 0, e: "Le présent « bleiben » a ici une valeur de futur." },
    { t: "„Er schlug vor, eine Pause zu ___.“", o: ["machen","machend","gemacht","macht"], a: 0, e: "Structure « vorschlagen, … zu + infinitif » : « machen »." },
    { t: "„Als wir ankamen, hatte der Film schon ___.“", o: ["begonnen","begann","beginnt","beginnen"], a: 0, e: "Antériorité passée → Plusquamperfekt « hatte begonnen »." },
    { t: "„Ich wünschte, ich ___ mehr Zeit.“", o: ["habe","hätte","werde haben","hatte"], a: 1, e: "Souhait irréel → Konjunktiv II « hätte »." },
    { t: "„___ sie mehr gelernt, hätte sie bestanden.“", o: ["Wenn sie lernte","Hätte sie","Sie hatte","Lernte sie"], a: 1, e: "Inversion conditionnelle : « Hätte sie gelernt » = « wenn sie gelernt hätte »." },
    { t: "„Der Vorschlag stieß auf ___ Skepsis.“", o: ["wenig","erhebliche","viele","voll"], a: 1, e: "L'adjectif décliné « erhebliche » (considérable) qualifie « Skepsis »." },
    { t: "„Sein Argument, ___ überzeugend, war letztlich unbelegt.“", o: ["jedoch","wenngleich","während","trotz"], a: 1, e: "« wenngleich » = « bien que » : concession suivie de l'adjectif." }
  ],
  "Portugais": [
    { t: "« Ela ___ ao trabalho todos os dias. »", o: ["vai","vais","ir","vão"], a: 0, e: "« ela » (3ᵉ pers.) : « ir » fait « vai »." },
    { t: "« ___ leite no frigorífico. »", o: ["Há","É","Está","Tem"], a: 0, e: "« há » (de haver) = il y a." },
    { t: "« Moro aqui ___ 2019. »", o: ["por","desde","durante","de"], a: 1, e: "« desde » = depuis (point de départ)." },
    { t: "« Se chover amanhã, ___ em casa. »", o: ["ficamos","ficaremos","ficássemos","ficávamos"], a: 1, e: "Futur « ficaremos » après une hypothèse réelle." },
    { t: "« Sugeriu ___ uma pausa. »", o: ["fazer","fazendo","feito","faz"], a: 0, e: "Après « sugeriu », l'infinitif : « fazer »." },
    { t: "« Quando chegámos, o filme já ___. »", o: ["começou","tinha começado","começa","começava"], a: 1, e: "Antériorité passée → mais-que-perfeito « tinha começado »." },
    { t: "« Quem dera que ele ___ mais tempo. »", o: ["tem","tinha","tivesse","terá"], a: 2, e: "« quem dera que » entraîne le subjonctif : « tivesse »." },
    { t: "« Se ___ mais, teria passado. »", o: ["estudava","tivesse estudado","estudou","estuda"], a: 1, e: "Condition irréelle : « se tivesse estudado »." },
    { t: "« A proposta foi recebida com um ceticismo ___. »", o: ["considerável","pouco","muitos","cheio"], a: 0, e: "« considerável » qualifie « ceticismo »." },
    { t: "« O seu argumento, ___ convincente, carecia de provas. »", o: ["contudo","embora","enquanto","apesar"], a: 1, e: "« embora » = « bien que » : concession suivie de l'adjectif." }
  ],
  "Chinois": [
    { t: "我 ___ 学生。", o: ["是","有","在","很"], a: 0, e: "« 是 » exprime « être » : 我是学生 = je suis étudiant." },
    { t: "冰箱里 ___ 牛奶。", o: ["有","是","在","都"], a: 0, e: "« 有 » exprime l'existence : 冰箱里有牛奶 = il y a du lait." },
    { t: "你 ___ 吃饭了吗？", o: ["已经","还","就","才"], a: 0, e: "« 已经 » = déjà (action accomplie, souvent avec 了)." },
    { t: "如果明天下雨，我们 ___ 在家。", o: ["就","才","都","也"], a: 0, e: "« 就 » introduit la conséquence après une condition (如果…就…)." },
    { t: "他 ___ 我高。", o: ["比","跟","和","像"], a: 0, e: "« 比 » sert à la comparaison : A 比 B 高 = A est plus grand que B." },
    { t: "我们到的时候，电影 ___ 开始了。", o: ["已经","正在","将要","刚刚"], a: 0, e: "« 已经…了 » indique qu'une action est déjà accomplie." },
    { t: "请 ___ 门关上。", o: ["把","被","给","让"], a: 0, e: "La construction « 把 » place l'objet avant le verbe : 把门关上." },
    { t: "这个问题 ___ 老师解决了。", o: ["被","把","给","对"], a: 0, e: "« 被 » marque le passif : 被老师解决 = résolu par le professeur." },
    { t: "他对这个计划表示 ___ 。", o: ["怀疑","高兴","知道","旅行"], a: 0, e: "« 怀疑 » = doute / scepticisme." },
    { t: "他的论点 ___ 有道理，但缺乏证据。", o: ["虽然","因为","所以","并且"], a: 0, e: "« 虽然…但… » = bien que… mais… (concession)." }
  ],
  "Arabe": [
    { t: "هي ___ إلى العمل كل يوم.", o: ["تذهب","يذهب","ذهب","نذهب"], a: 0, e: "« تذهب » = elle va (accord féminin avec هي)." },
    { t: "___ حليب في الثلاجة.", o: ["هناك","هو","في","على"], a: 0, e: "« هناك » exprime l'existence (il y a)." },
    { t: "أسكن هنا ___ 2019.", o: ["منذ","لـ","خلال","من"], a: 0, e: "« منذ » marque le point de départ (depuis)." },
    { t: "إذا أمطرت غدًا، ___ في البيت.", o: ["سنبقى","بقينا","يبقى","ابقَ"], a: 0, e: "« سـ » + verbe exprime le futur : سنبقى = nous resterons." },
    { t: "اقترح ___ استراحة.", o: ["أن نأخذ","أخذنا","نأخذ","خذ"], a: 0, e: "Après « اقترح », on emploie « أن » + verbe : أن نأخذ." },
    { t: "عندما وصلنا، كان الفيلم قد ___.", o: ["بدأ","يبدأ","يبدأون","بداية"], a: 0, e: "« كان قد + accompli » marque l'antériorité dans le passé." },
    { t: "أتمنى لو ___ وقتًا أكثر.", o: ["كان لديّ","لديّ","سيكون","يكون"], a: 0, e: "Souhait irréel : « لو كان لديّ » (si j'avais)." },
    { t: "لو ___ أكثر، لنجحت.", o: ["درست","تدرس","ستدرس","ادرس"], a: 0, e: "« لو » + accompli exprime la condition irréelle : لو درست." },
    { t: "قوبل الاقتراح بـ ___ كبير.", o: ["شكّ","فرح","علم","سفر"], a: 0, e: "« شكّ » = doute / scepticisme." },
    { t: "حجته، ___ كانت مقنعة، تفتقر إلى الأدلة.", o: ["مع أنها","لأنها","لذلك","لكن"], a: 0, e: "« مع أنّ » = bien que (concession)." }
  ],
  "Japonais": [
    { t: "彼女は毎日仕事に ___ 。", o: ["行きます","行く","来ます","食べます"], a: 0, e: "« 行きます » = aller (forme polie au présent)." },
    { t: "冷蔵庫に牛乳が ___ 。", o: ["あります","います","します","です"], a: 0, e: "« あります » exprime l'existence pour les objets inanimés." },
    { t: "私は2019年 ___ ここに住んでいます。", o: ["から","まで","で","に"], a: 0, e: "« から » = depuis (point de départ)." },
    { t: "明日雨が降ったら、家に ___ 。", o: ["います","いました","いる","いません"], a: 0, e: "« 家にいます » = rester / être à la maison (forme polie)." },
    { t: "窓を ___ ください。", o: ["開けて","開けた","開ける","開け"], a: 0, e: "« 〜てください » exprime une demande polie : 開けてください." },
    { t: "私たちが着いたとき、映画はもう ___ いた。", o: ["始まって","始まる","始まり","始め"], a: 0, e: "« 〜ていた » indique une action déjà accomplie (始まっていた)." },
    { t: "もっと時間が ___ いいのに。", o: ["あれば","ある","あって","あった"], a: 0, e: "« 〜ばいいのに » exprime un souhait / regret." },
    { t: "もっと勉強 ___ 、合格しただろう。", o: ["していれば","して","したら","する"], a: 0, e: "« 〜ば » exprime la condition : していれば = si j'avais étudié." },
    { t: "その提案は大きな ___ を持って迎えられた。", o: ["疑い","喜び","知識","食べ物"], a: 0, e: "« 疑い » = doute / scepticisme." },
    { t: "彼の主張は、説得力が ___ 、証拠に欠けていた。", o: ["あるものの","あるので","あるから","あって"], a: 0, e: "« 〜ものの » = bien que (concession)." }
  ],
  "Hongrois": [
    { t: "Ő minden nap ___ dolgozni.", o: ["megy","mész","megyek","mennek"], a: 0, e: "« ő » (3ᵉ pers. sing.) : « menni » fait « megy »." },
    { t: "___ tej a hűtőben.", o: ["Van","Vannak","Lesz","Volt"], a: 0, e: "« van » exprime l'existence (il y a) au singulier." },
    { t: "2019 ___ itt lakom.", o: ["óta","-ig","alatt","-ból"], a: 0, e: "« óta » = depuis (point de départ)." },
    { t: "Ha holnap esik, otthon ___.", o: ["maradunk","maradtunk","maradnánk","maradtak"], a: 0, e: "Le présent « maradunk » a valeur de futur après « ha »." },
    { t: "Azt javasolta, hogy ___ egy szünetet.", o: ["tartsunk","tartani","tartottunk","tart"], a: 0, e: "Après « javasolta, hogy », on emploie le subjonctif : « tartsunk »." },
    { t: "Mire megérkeztünk, a film már ___.", o: ["elkezdődött","kezdődik","kezd","kezdeni"], a: 0, e: "Antériorité dans le passé : « elkezdődött » (avait commencé)." },
    { t: "Bárcsak több időm ___!", o: ["lenne","van","volt","lesz"], a: 0, e: "« bárcsak » + conditionnel « lenne » exprime le souhait." },
    { t: "Ha többet ___, átment volna.", o: ["tanult volna","tanul","tanult","tanulna"], a: 0, e: "Conditionnel passé : « tanult volna » (aurait étudié)." },
    { t: "A javaslatot jelentős ___ fogadták.", o: ["kétkedéssel","örömmel","tudással","étellel"], a: 0, e: "« kétkedés » = scepticisme (ici au cas instrumental -vel)." },
    { t: "Az érve, ___ meggyőző volt, nélkülözte a bizonyítékot.", o: ["bár","mert","ezért","de"], a: 0, e: "« bár » = bien que (concession)." }
  ],
  "Serbe": [
    { t: "Она ___ на посао сваког дана.", o: ["иде","идем","идеш","иду"], a: 0, e: "« она » (3ᵉ pers. sing.) : « ићи » fait « иде »." },
    { t: "___ млека у фрижидеру.", o: ["Има","Је","Су","Биће"], a: 0, e: "« има » exprime l'existence (il y a)." },
    { t: "Живим овде ___ 2019.", o: ["од","до","током","из"], a: 0, e: "« од » = depuis (point de départ)." },
    { t: "Ако сутра пада киша, ___ код куће.", o: ["остаћемо","остали смо","остајемо","остасмо"], a: 0, e: "Futur « остаћемо » (nous resterons) après une condition réelle." },
    { t: "Предложио је да ___ паузу.", o: ["направимо","направити","направили","прави"], a: 0, e: "Après « предложио је да », on emploie le présent : « да направимо »." },
    { t: "Када смо стигли, филм је већ ___.", o: ["почео","почиње","почети","почео би"], a: 0, e: "Antériorité dans le passé : « почео » (avait commencé)." },
    { t: "Волео бих да ___ више времена.", o: ["имам","имао сам","имаћу","имао бих"], a: 0, e: "« Волео бих да » + présent : « да имам » (souhait)." },
    { t: "Да је ___ више, положила би.", o: ["учила","учи","учиће","учила би"], a: 0, e: "Condition irréelle : « да је учила » (si elle avait étudié)." },
    { t: "Предлог је дочекан са ___ скепсом.", o: ["знатном","мало","многи","пуно"], a: 0, e: "« знатном » (considérable) s'accorde avec « скепсом » à l'instrumental." },
    { t: "Његов аргумент, ___ убедљив, није имао доказа.", o: ["иако","јер","зато","али"], a: 0, e: "« иако » = bien que (concession)." }
  ],
  "Russe": [
    { t: "Она ___ на работу каждый день.", o: ["ходит","идут","идёшь","иду"], a: 0, e: "Pour une action habituelle, on emploie « ходит » (она ходит)." },
    { t: "В холодильнике ___ молоко.", o: ["есть","является","быть","имеет"], a: 0, e: "« есть » exprime l'existence (il y a)." },
    { t: "Я живу здесь ___ 2019 года.", o: ["с","до","во время","из"], a: 0, e: "« с » = depuis (с 2019 года)." },
    { t: "Если завтра пойдёт дождь, мы ___ дома.", o: ["останемся","остались","оставались","остаёмся"], a: 0, e: "Futur perfectif « останемся » (nous resterons)." },
    { t: "Он предложил ___ перерыв.", o: ["сделать","делая","сделанный","делает"], a: 0, e: "Après « предложил », l'infinitif : « сделать »." },
    { t: "Когда мы пришли, фильм уже ___.", o: ["начался","начинается","начнётся","начать"], a: 0, e: "Action déjà accomplie dans le passé : « уже начался »." },
    { t: "Хотел бы я, чтобы у меня ___ больше времени.", o: ["было","есть","будет","имеет"], a: 0, e: "Après « чтобы », le verbe se met au passé : « было » (souhait irréel)." },
    { t: "Если бы она ___ больше, она бы сдала.", o: ["училась","учится","выучит","учить"], a: 0, e: "Condition irréelle : « если бы она училась »." },
    { t: "Предложение было встречено со ___ скептицизмом.", o: ["значительным","мало","многие","полный"], a: 0, e: "« значительным » (considérable) s'accorde avec « скептицизмом » à l'instrumental." },
    { t: "Его аргумент, ___ убедительный, не имел доказательств.", o: ["хотя и","потому что","поэтому","но"], a: 0, e: "« хотя и » = bien que (concession)." }
  ]
};
