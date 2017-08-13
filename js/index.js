(function () {
    // Вершинный шейдер из примеров в гисте
    const VertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `

    // Шейдер, который аддитивно смешивает две текстуры
    const additiveBlendShader = {
        uniforms: {
            tDiffuseA: {value: null},
            tDiffuseB: {value: null},
            alpha: {value: 0.5}
        },
        vertexShader: VertexShader,
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D tDiffuseA;
            uniform sampler2D tDiffuseB;
            uniform float alpha;

            void main(void) {
                vec4 texelA = texture2D(tDiffuseA, vUv);
                vec4 texelB = texture2D(tDiffuseB, vUv);
                gl_FragColor = (texelA + texelB) * alpha + texelA * (1.0 - alpha);
            }
        `
    }

    // Фильтр по яркости (как в примерах)
    const luminosityHiPassShader = {
        shaderID: 'luminosityHighPass', // просто идентификатор
        uniforms: {
            tDiffuse: {value: null},
            defaultOpacity: {value: 0.0},
            defaultColor: {value: new THREE.Color(0x000000)},
            luminosityThreshold: {value: 0.5},
            smoothWidth: {value: 0.2}
        },
        vertexShader: VertexShader,
        fragmentShader: `
            varying vec2 vUv;

            uniform sampler2D tDiffuse;

            uniform float defaultOpacity;
            uniform vec3 defaultColor;
            uniform float luminosityThreshold;
            uniform float smoothWidth;

            void main(void)
            {
                vec4 texel = texture2D(tDiffuse, vUv);
                vec3 luma = vec3(0.299, 0.587, 0.114);
                float l = dot(texel.rgb, luma);
                float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, l);
                vec4 outputColor = vec4(defaultColor.rgb, defaultOpacity);
                gl_FragColor = mix(outputColor, texel, alpha);
            }
        `
    }

    // Один проход размытия по Гауссу (вертикальный или горизонтальный)
    // Для полного размытия надо применить последовательно два прохода
    // в разных направлениях
    const fastGaussianBlurShader = {
        defines: {
            KERNEL_RADIUS: 6,
        },
        uniforms: {
            tDiffuse: {value: null},
            texSize: {value: null},
            direction: {value: null}
        },
        vertexShader: VertexShader,
        fragmentShader: `
            varying vec2 vUv;

            uniform sampler2D tDiffuse;
            uniform vec2 texSize;
            uniform vec2 direction;

            float gaussianPdf(in float x, in float sigma) {
                return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
            }

            void main(void)
            {
                float sigma = float(KERNEL_RADIUS);
                vec2 invSize = 1.0 / texSize;

                float weightSum = gaussianPdf(0.0, sigma);
                vec3 diffuseSum = texture2D(tDiffuse, vUv).rgb * weightSum;

                for(int i = 1; i < KERNEL_RADIUS; i++) {
                    float x = float(i);
                    float w = gaussianPdf(x, sigma);
                    vec2 vUvOffset = direction * invSize * x;
                    vec3 sample1 = texture2D(tDiffuse, vUv + vUvOffset).rgb;
                    vec3 sample2 = texture2D(tDiffuse, vUv - vUvOffset).rgb;
                    diffuseSum += (sample1 + sample2) * w;
                    weightSum += 2.0 * w;
                }

                gl_FragColor = vec4(diffuseSum/weightSum, 1.0);
            }
        `
    }

    // За основу взят fastGaussianBlurShader. Размытие применяется к 1/4 сцены спава и слева.
    // Чтобы дорога не размывалась, отсекаем 1/4 снизу.
    // Чтобы не было резкой границы размыто-неразмыто, 
    // используем встроенную функцию smoothstep для расчета коеффициента радиуса.
    // Чтобы сделать отраженный эффект размытия, получаем отраженный вектор при помощи встроенной функции reflect.
    const motionBlurShader = {
        defines: {
            KERNEL_RADIUS: 60,
        },
        uniforms: {
            tDiffuse: {value: null},
            texSize: {value: null},
            direction: {value: null}
        },
        vertexShader: VertexShader,
        fragmentShader: `
            varying vec2 vUv;

            uniform sampler2D tDiffuse;
            uniform vec2 texSize;
            uniform vec2 direction;

            float gaussianPdf(in float x, in float sigma) {
                return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
            }

            vec4 gaussianBlur(in vec2 direction, in float position) {
                float radiusWeight = smoothstep(0.0, 1.0, position);
                float sigma = float(KERNEL_RADIUS) * radiusWeight;
                vec2 invSize = 1.0 / texSize;

                float weightSum = gaussianPdf(0.0, sigma);
                vec3 diffuseSum = texture2D(tDiffuse, vUv).rgb * weightSum;

                for(int i = 1; i < KERNEL_RADIUS; i++) {
                    float x = float(i);
                    float w = gaussianPdf(x, sigma);
                    vec2 vUvOffset = direction * invSize * x;
                    vec3 sample1 = texture2D(tDiffuse, vUv + vUvOffset).rgb;
                    vec3 sample2 = texture2D(tDiffuse, vUv - vUvOffset).rgb;
                    diffuseSum += (sample1 + sample2) * w;
                    weightSum += 2.0 * w;
                }

                return vec4(diffuseSum/weightSum, 1.0);
            }

            void main(void)
            {
                vec2 position = vUv;
                vec4 color;

                if (position.x < 0.25 && position.y > 0.25) {
                    color = gaussianBlur(direction, 0.25 - position.x);
                } else if (position.x > 0.75 && position.y > 0.25) {
                    vec2 normalVec = vec2(0.0, 1.0);
                    vec2 reflection = reflect(direction, normalVec);

                    color = gaussianBlur(reflection, position.x - 0.75);
                } else {
                    color = texture2D(tDiffuse, position);
                }
                
                gl_FragColor = color;
            }
        `
    }

    class RoadActor extends Actor {
        constructor(textures, cubeCamera) {
            super(new THREE.Object3D())

            // Сегменты дороги
            this.segmentLength = 100
            this.segments = []
            this.segmentsCount = 0

            this.segmentGeometry = new THREE.PlaneBufferGeometry(
                4, this.segmentLength,
                1, 1
            )
            this.segmentMaterial = new THREE.MeshPhysicalMaterial({
                color: 0x000044,
                metalness: .95,
                roughness: 0.01,
                reflectivity: 0.75,
                emissive: 0xffffff,
                emissiveMap: textures.roadEmissive,
                emissiveIntensity: 10,
                envMap: cubeCamera.renderTarget.texture,
            })

            // Препятствия
            this.bricks = []

            this.brickGeometry = new THREE.BoxBufferGeometry(0.8, 1, 0.2)
            this.brickMaterial = new THREE.MeshPhongMaterial({
                color: 0x00ff00,
                emissive: 0x00ff00,
                emissiveIntensity: 2
            })

            this.position = new THREE.Vector3(
                0, 0, this.segmentLength / 2
            )

            this.addSegment()
            
            setInterval(() => {
                this.addBrick()
            }, 750)
        }

        addSegment() {
            const segment = new THREE.Mesh(
                this.segmentGeometry,
                this.segmentMaterial
            )
            const rotation = new THREE.Quaternion()
            rotation.setFromAxisAngle(
                new THREE.Vector3(1, 0, 0),
                -Math.PI/2
            )
            segment.setRotationFromQuaternion(rotation)
            segment.position.set(
                0,
                0,
                this.segmentsCount*this.segmentLength
            )
            this.model.add(segment)
            this.segmentsCount++
            this.segments.push(segment)
        }

        addBrick() {
            const brick = new THREE.Mesh(
                this.brickGeometry,
                this.brickMaterial
            )
            const rotation = new THREE.Quaternion()
            rotation.setFromAxisAngle(
                new THREE.Vector3(1, 0, 0),
                -Math.PI/2
            )
            brick.setRotationFromQuaternion(rotation)
            brick.position.set(
                Math.floor(Math.random() * 4) - 1.5,
                0,
                this.segmentsCount*this.segmentLength + Math.floor(Math.random() * this.segmentLength)
            )
            this.model.add(brick)
            this.bricks.push(brick)
        }

        update(delta, gameState) {
            const newPosition = new THREE.Vector3()
            newPosition.addVectors(
                this.position,
                new THREE.Vector3(0, 0, -gameState.speed*delta/1000)
            )
            this.position = newPosition

            const car = gameState.actors[0]
            const carBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())
            carBox.setFromObject(car.model)
            this.bricks.forEach((brick) => {
                const brickBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())
                brickBox.setFromObject(brick)
                if (brickBox.intersectsBox(carBox)) {
                    game.stop()

                    const userMessage = document.querySelector(".message")
                    const messageContainer = document.querySelector(".message-container")

                    messageContainer.classList.remove("message-container__hidden")
                    userMessage.innerHTML = "Game over ¯\_(ツ)_/¯"

                    setTimeout(() => {
                        userMessage.classList.remove("message__transparent")
                    }, 300)

                }
            })

            const roadLeft = this.position.z + this.segmentsCount*this.segmentLength
            const VISIBLE_SEGMENTS = 2
            if (roadLeft < VISIBLE_SEGMENTS*this.segmentLength) {
                this.addSegment()
            }

            if (this.segments.length > VISIBLE_SEGMENTS + 1) {
                const firstSegment = this.segments.shift()

                const brickToRemove = []
                const brickToStore = []
                this.bricks.forEach((brick) => {
                    if (brick.position.z < firstSegment.position.z + this.segmentLength && brick.position.z > firstSegment.position.z) {
                        brickToRemove.push(brick)
                    } else {
                        brickToStore.push(brick)
                    }
                })

                this.bricks = brickToStore
                brickToRemove.forEach((brick) => {
                    this.model.remove(brick)
                })
                this.model.remove(firstSegment)
            }

            super.update(delta, gameState)
        }
    }

    class CarActor extends Actor {
        constructor(model) {
            super(new THREE.Object3D())
            model.position.set(0.1, 0, 0)
            this.model.add(model)
        }

        update(delta, gameState) {}
    }

    class RaceGameState extends GameState {
        constructor() {
            super()

            this.speed = 10
            this.trackLimits = [
                0.9,
                -0.1,
                -1.1,
                -2.1
            ]
        }

        init(renderer) {
            const height = window.innerHeight
            const width = window.innerWidth

            this.renderer = renderer
            this.scene = new THREE.Scene()

            this.camera = new THREE.PerspectiveCamera(
                45,
                width / height,
                1,
                2000
            )

            // Настраиваем постпроцессинг

            // Вместо обычного рендерера будем использовать THREE.EffectComposer,
            // который рендерит цепочку обработок, используя есть два буфера:
            //  - из одного буфера он читает входную текстуру и передает ее в текущую обработку
            //  - в другой рендерит результат обработки
            //  - если у текущей обработки свойство needsSwap === true - буферы меняются местами
            // Таким образом рендерим сложные эффекты за несколько проходов.
            //
            // Подробнее: https://github.com/mrdoob/three.js/blob/master/examples/js/postprocessing/EffectComposer.js
            this.composer = new THREE.EffectComposer(renderer)
            this.composer.setSize(window.innerWidth, window.innerHeight)

            // Первый проход - обычный рендеринг сцены без эффектов
            this.composer.addPass(new THREE.RenderPass(this.scene, this.camera))

            // Далее сохраняем результат рендеринга (он потом пригодится)
            // Картинка сохраняется в saveOriginalPass.renderTarget.texture
            // Эту текстуру дальше уже можно использовать где угодно
            const saveOriginalPass = new THREE.SavePass()
            saveOriginalPass.renderTarget.texture.name = 'OriginalPass.rt'
            this.composer.addPass(saveOriginalPass)

            // Обрабатываем полученную картинку нашим кастомным hipass-фильтром,
            // используя THREE.ShaderPass
            // Первый аргумент - объект с настройками шейдера
            // Второй (опциональный) - название uniform'а, в который будет передан
            // результат предыдущих шагов (по умолчанию 'tDiffuse')
            const luminosityPass = new THREE.ShaderPass(luminosityHiPassShader)
            luminosityPass.uniforms.luminosityThreshold.value = 0.5
            luminosityPass.uniforms.smoothWidth.value = 0.1
            this.composer.addPass(luminosityPass)

            // ... потом делаем горизонтальный проход размытия...
            const blurHorizontalPass = new THREE.ShaderPass(fastGaussianBlurShader)
            blurHorizontalPass.uniforms.texSize.value = new THREE.Vector2(width/2, height/2)
            blurHorizontalPass.uniforms.direction.value = new THREE.Vector2(1.0, 0.0)
            this.composer.addPass(blurHorizontalPass)

            // ... и потом еще вертикальный
            const blurVerticalPass = new THREE.ShaderPass(fastGaussianBlurShader)
            blurVerticalPass.uniforms.texSize.value = new THREE.Vector2(width/2, height/2)
            blurVerticalPass.uniforms.direction.value = new THREE.Vector2(0.0, 1.0)
            this.composer.addPass(blurVerticalPass)

            // И теперь смешаем нормальную картинку (которую сохранили на втором шаге)
            // и картинку с размытыми яркими областями
            const blendPass = new THREE.ShaderPass(additiveBlendShader, 'tDiffuseB')
            blendPass.uniforms.tDiffuseA.value = saveOriginalPass.renderTarget.texture
            blendPass.uniforms.alpha.value = 0.8
            this.composer.addPass(blendPass)

            // Добавим эффект размытия по бокам
            const motionBlurPass = new THREE.ShaderPass(motionBlurShader)
            motionBlurPass.uniforms.texSize.value = new THREE.Vector2(width/2, height/2)
            motionBlurPass.uniforms.direction.value = new THREE.Vector2(0.7, 0.3)
			motionBlurPass.renderToScreen = true;
			this.composer.addPass( motionBlurPass );

            let rotation = new THREE.Quaternion()
            rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
            this.camera.setRotationFromQuaternion(rotation)
            this.camera.position.set(0, 1, -6)

            window.addEventListener('resize', () => {
                const height = window.innerHeight
                const width = window.innerWidth
                this.camera.aspect = width / height
                this.camera.updateProjectionMatrix()

                // Обновим также и размеры нашего композера
                this.composer.setSize(width, height)
            })

            const models = [
                ['car', './assets/models/car.dae', 'Car']
            ]

            const textures = [
                ['cityscape', './assets/maps/cityscape-p2-blue.jpg'],
                ['roadEmissive', './assets/maps/road-emissive.png'],
            ]

            const userMessage = document.querySelector(".message")
            const messageContainer = document.querySelector(".message-container")

            return Promise.all([loadModels(models), loadTextures(textures)]).then(([models, textures]) => {
                this.models = models
                this.textures = textures

                // Mirror Camera
                this.mirrorCubeCamera = new THREE.CubeCamera(
                    0.1,
                    2000,
                    256
                )
                this.scene.add(this.mirrorCubeCamera)

                // Actors
                this.carActor = new CarActor(this.models.car)
                this.track = 1
                this.roadActor = new RoadActor(
                    this.textures,
                    this.mirrorCubeCamera
                )

                this.actors = [
                    this.carActor,
                    this.roadActor
                ]

                this.scene.add(this.carActor.model)
                this.scene.add(this.roadActor.model)

                const skyboxGeometry = new THREE.PlaneBufferGeometry(1100, 350, 1, 1)
                const skyboxMaterial = new THREE.MeshBasicMaterial({
                    wireframe: false,
                    map: this.textures.cityscape
                })
                const skybox = new THREE.Mesh(
                    skyboxGeometry,
                    skyboxMaterial
                )
                this.scene.add(skybox)
                skybox.position.set(0, 64, 400)
                rotation = new THREE.Quaternion()
                rotation.setFromAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    Math.PI
                )
                skybox.setRotationFromQuaternion(rotation)

                // Lights
                const ambientLight = new THREE.AmbientLight(0x333333)
                this.scene.add(ambientLight)
                const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
                directionalLight.position.set(1,1,1).normalize()
                this.scene.add(directionalLight)

                console.log('init finished', this.scene)
            })
            .then(() => {
                const carCtrlLeft = document.querySelector('.car-control__left')
                const carCtrlRight = document.querySelector('.car-control__right')

                const cameraCtrlLeft = document.querySelector('.camera-control__left')
                const cameraCtrlRight = document.querySelector('.camera-control__right')
                const cameraCtrlUp = document.querySelector('.camera-control__up')
                const cameraCtrlDown = document.querySelector('.camera-control__down')

                carCtrlLeft.addEventListener('click', this._moveCarleft.bind(this))
                carCtrlRight.addEventListener('click', this._moveCarRight.bind(this))

                document.addEventListener('keydown', (event) => {
                    const keycode = event.keyCode
                    switch(keycode) {
                        case 37: 
                        this._moveCarleft()
                        break
                        case 39: 
                        this._moveCarRight()
                        break
                        default: 
                        break
                    }
                })

                document.addEventListener('mousemove', (event) => {
                    if (event.buttons) {
                        const deltaX = event.movementX / window.innerWidth;
                        const deltaY = - event.movementY / window.innerHeight;
                        const position = this.camera.position

                        this.camera.position.set(position.x + deltaX, position.y + deltaY, position.z)
                    }
                })

                cameraCtrlLeft.addEventListener('click', () => {
                    const position = this.camera.position
                    this.camera.position.set(position.x + 0.1, position.y, position.z)
                })
                cameraCtrlRight.addEventListener('click', () => {
                    const position = this.camera.position
                    this.camera.position.set(position.x - 0.1, position.y, position.z)
                })
                cameraCtrlUp.addEventListener('click', () => {
                    const position = this.camera.position
                    this.camera.position.set(position.x, position.y + 0.1, position.z)
                })
                cameraCtrlDown.addEventListener('click', () => {
                    const position = this.camera.position
                    this.camera.position.set(position.x, position.y - 0.1, position.z)
                })
            })
            .then(() => {
                let i = 1;
                let interval = setInterval(() => {
                    userMessage.classList.remove("message__transparent")
                    if (i < 4) {
                        userMessage.innerHTML = i
                    } else if (i === 4) {
                        userMessage.innerHTML = 'Go!'
                        clearInterval(interval)
                        setTimeout(() => {
                            userMessage.classList.add("message__transparent")
                            setTimeout(() => {
                                userMessage.innerHTML = ""
                                messageContainer.classList.add("message-container__hidden")
                            }, 300)
                        }, 1000)
                    }
                    i++

                    setTimeout(() => {
                        userMessage.classList.add("message__transparent")
                    }, 1000)
                }, 1500)
            })
        }

        update(delta) {
            super.update(delta)

            this.mirrorCubeCamera.position.set(
                this.camera.position.x,
                -this.camera.position.y,
                this.camera.position.z
            )
        }

        render(delta) {
            this.roadActor.model.visible = false
            this.mirrorCubeCamera.updateCubeMap(
                this.renderer,
                this.scene
            )
            this.roadActor.model.visible = true
            // И вместо this.renderer.render(this.scene, this.camera)
            // используем для рендеринга наш THREE.EffectComposer
            this.composer.render()
        }

        _moveCarRight() {
            const position = this.carActor.model.position
            let x = position.x
            const track = this.track
            if (this.trackLimits[track + 1]) {
                this.track++
                x = this.trackLimits[this.track]
            }
            this.carActor.model.position.set(x, position.y, position.z)
        }

        _moveCarleft() {
            const position = this.carActor.model.position
            let x = position.x
            const track = this.track
            if (this.trackLimits[track - 1]) {
                this.track--
                x = this.trackLimits[this.track]
            }
            this.carActor.model.position.set(x, position.y, position.z)
        }
    }

    const raceGameState = new RaceGameState()
    const game = new Game(document.getElementById('container'))
    game.pushState(raceGameState).then(() => {
        game.run()
    })
})()
